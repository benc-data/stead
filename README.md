# Stead

Stead is a self-hosted household budgeting app. It shows where your money went, what bills are coming up, and how low your balance could get before payday. Two people can share one budget using their own Google accounts. Stead can also be installed from your browser as a home-screen app.

## Try it with sample data

Install [Node.js 22](https://nodejs.org/), version 22.12 or later, then run these commands from the project folder.

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. The demo uses generated transactions and needs no accounts, subscriptions, or API keys.

## What you need for your own budget

- **Firebase** hosts the app, signs in household members, and stores your budget in Cloud Firestore. Deploying the backend requires Firebase **Blaze**, which links a Google Cloud billing account and bills for usage. [Firebase pricing](https://firebase.google.com/pricing)
- **SimpleFIN Bridge** is required to import live bank balances and transactions. It offers read-only access and currently costs **$1.50/month or $15/year**, plus tax. Check that it supports your institutions before subscribing. [SimpleFIN Bridge](https://bridge.simplefin.org/)
- **Google Cloud Gemini** is optional for daily coaching and AI-assisted categorization. Model calls are billed through your Google Cloud project. The deployed functions use their Google Cloud identity, so you don't need a separate Gemini subscription, API key, or service-account JSON file. [Google Cloud model pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)

## 1. Create your Firebase project

1. In the [Firebase console](https://console.firebase.google.com/), create a project and register a **Web app** under **Project settings → General → Your apps**.
2. In **Authentication → Sign-in method**, enable **Google** and select a project support email. [Firebase Google sign-in setup](https://firebase.google.com/docs/auth/web/google-signin)
3. Create the default **Cloud Firestore** database in **Production mode**.
4. In the Firestore console, create collection `settings` and document `household`. Add a string field called `primaryEmail` with your exact Google account email. For a second member, add another string field called `spouseEmail` with their exact Google account email. Keep these values in Firestore. Only verified Google accounts listed here can access the budget. Remove an email from this document to revoke access.
5. Copy `.env.example` to `.env.local`. Fill in the six `VITE_FIREBASE_*` fields using the SDK config under **Project settings → General → Your apps**. For example, `VITE_FIREBASE_API_KEY` takes the value of `apiKey`, and `VITE_FIREBASE_PROJECT_ID` takes `projectId`. The Firebase web config is shipped to browsers. Keep bank tokens and other private credentials out of all `VITE_*` variables. [Firebase web setup](https://firebase.google.com/docs/web/setup)

## 2. Deploy the app

Install the [Firebase CLI](https://firebase.google.com/docs/cli) and run the following from the project folder. Replace `YOUR_PROJECT_ID` in each command with the Firebase **project ID** from step 1.

```sh
firebase login
npm ci
npm --prefix functions ci
npm run build
firebase deploy --only firestore:rules,hosting --project YOUR_PROJECT_ID
```

Open `https://YOUR_PROJECT_ID.firebaseapp.com` and sign in with your allowlisted Google account. The deployed app will be empty until you import transactions. Keep using that Firebase Hosting hostname for Google sign-in redirects.

## 3. Connect your bank

1. Upgrade your Firebase project to **Blaze**. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) and run `gcloud auth login` with an account that can enable Secret Manager and manage secrets in the project.
2. Sign in to [SimpleFIN Bridge](https://bridge.simplefin.org/), link your institutions, and create a fresh **setup token** for Stead. Add it to a local `.env` file in the project root as `SIMPLEFIN_APIKEY=YOUR_SETUP_TOKEN`.
3. Run the setup command below. It exchanges the one-time setup token for a private access URL and saves the URL in your project's Secret Manager as `SIMPLEFIN_ACCESS_URL`. After the command succeeds, remove the token from your local `.env`. [SimpleFIN token exchange](https://beta-bridge.simplefin.org/info/developers)
4. If you want to keep daily coaching off, create the Firestore document `settings/coach` with Boolean field `enabled` set to `false` and an empty string field `note` before deploying functions. You can also change the setting in the app later.

```sh
npm run connect:bank -- YOUR_PROJECT_ID
firebase deploy --only functions --project YOUR_PROJECT_ID
```

Choose **Sync bank** in Stead to import your accounts and transactions. The first import requests up to 400 days, subject to your bank's history limit. Afterward, sync runs every six hours.

## 4. Enable AI features if you want them

Enable the [Vertex AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com) in the same project. In Google Cloud IAM, grant the runtime service accounts for `nightlyCoach` and `processCategoryAction` the `roles/aiplatform.user` role. Find the runtime service account on each deployed function's details page. [Google Cloud model access control](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/access-control)

The daily coach uses `GEMINI_MODEL` from `functions/.env.YOUR_PROJECT_ID` if set. Choose a Gemini model available on the global endpoint that supports the thinking settings used by the coach. The bulk categorizer uses the Flash-Lite model configured in `functions/category-review.js`. Redeploy functions after changing their configuration.

The daily coach sends category totals, calculated cash projections, savings goal names and progress, and the household note to Google Cloud. You can disable it in **Paychecks → Coach**. When you request AI suggestions in **Bulk categorize**, the app sends merchant labels and whether money moved in or out. You can categorize transactions manually.

## How the budget works

- **Flight deck** shows spending and projects the lowest cash balance before payday. The optional spending estimate uses past cycles and is displayed separately from dated bills.
- **Activity** lets you categorize or split transactions, remember a merchant's category, and review purchases in bulk. Use **Transfer** for internal transfers and credit card payments to exclude them from spending.
- **Paychecks** projects the next two paydays using a schedule of the 15th and the last day of each month. Add known bills and expected income to improve the forecast. Verify due dates and minimum payments against your statements.
- **Savings goals** earmark part of a balance in Stead. SimpleFIN only imports account data. Stead never moves money.
- Dates use the America/Chicago time zone. Different currencies are tracked separately.

On iPhone, open Stead in Safari and choose **Share → Add to Home Screen**. On Android, use Chrome's install or Add to Home screen menu item.

## Develop and test

Run `npm test` for the calculation and data-processing tests and `npm run build` for the production build. For local Auth and Firestore, start the Firebase emulators with `firebase emulators:start --only auth,firestore --project demo-stead` and run `VITE_USE_EMULATORS=true npm run dev` in another terminal. Add the `settings/household` document in the Firestore emulator and use the Auth emulator's mock Google sign-in with the matching email.
