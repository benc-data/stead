import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { accessCredentials, claimUrl } from '../functions/simplefin.js';

const root = new URL('../', import.meta.url);
const secret = 'SIMPLEFIN_ACCESS_URL';

function cloud(project, args, input) {
  return spawnSync('gcloud', [...args, '--project', project, '--quiet'], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function connect() {
  let project = process.argv[2];
  if (!project) {
    try {
      project = JSON.parse(readFileSync(new URL('.firebaserc', root), 'utf8')).projects?.default;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!project) throw new Error('Run npm run connect:bank -- YOUR_PROJECT_ID.');

  const billing = cloud(project, ['billing', 'projects', 'describe', project, '--format=value(billingEnabled)']);
  if (billing.status !== 0 || billing.stdout.trim().toLowerCase() !== 'true') {
    throw new Error('Enable Blaze billing for the budgeting project and sign in to gcloud before connecting SimpleFIN.');
  }
  const token = process.env.SIMPLEFIN_APIKEY || parseEnv(readFileSync(new URL('.env', root), 'utf8')).SIMPLEFIN_APIKEY;
  let url;
  try {
    url = claimUrl(token ?? '');
  } catch {
    throw new Error('Set SIMPLEFIN_APIKEY to a fresh SimpleFIN setup token in .env.');
  }
  if (cloud(project, ['services', 'enable', 'secretmanager.googleapis.com']).status !== 0) {
    throw new Error('Secret Manager could not be enabled. Check your Google Cloud permissions and try again.');
  }
  const describe = cloud(project, ['secrets', 'describe', secret]);
  if (describe.status !== 0 && cloud(project, ['secrets', 'create', secret, '--replication-policy=automatic']).status !== 0) {
    throw new Error('The SimpleFIN secret could not be prepared. The setup token is still available.');
  }

  const response = await fetch(url, {
    method: 'POST', body: '', redirect: 'error', signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!response?.ok) {
    throw new Error(response?.status === 403 ? 'SimpleFIN rejected the setup token. Check whether it was already used.'
      : 'SimpleFIN did not confirm the claim. Check the Bridge connection before retrying.');
  }
  const access = (await response.text()).trim();
  try {
    accessCredentials(access);
  } catch {
    throw new Error('SimpleFIN returned an access URL the app could not validate.');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = cloud(project, ['secrets', 'versions', 'add', secret, '--data-file=-'], access);
    if (stored.status === 0) {
      console.log('SimpleFIN access was saved in Secret Manager. Deploy the Firebase Functions to activate sync.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('Secret Manager rejected the write after the token was claimed. Revoke that connection in SimpleFIN and create a fresh token after fixing write access.');
}

try {
  await connect();
} catch (error) {
  console.error(error.code === 'ENOENT' ? 'Put SIMPLEFIN_APIKEY in a local .env file first.' : error.message);
  process.exitCode = 1;
}
