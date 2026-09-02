# Google OAuth and Picker setup

AutoSale uses one Google Cloud project per environment. Production tenants authorize the AutoSale OAuth web client and explicitly select spreadsheets through Google Picker. Customers never receive or upload OAuth secrets.

## APIs

Enable Google Sheets API, Google Drive API, and Google Picker API in the project.

## OAuth web client

Configure Google Auth Platform for an external audience and create a Web application client.

- Production JavaScript origin: `https://sales-aito.com`
- Production redirect URI: `https://sales-aito.com/api/integrations/google/callback`
- Scope requested by AutoSale: `https://www.googleapis.com/auth/drive.file`

Use separate development and production clients. Development may use `http://localhost/api/integrations/google/callback`; production callbacks must use HTTPS.

Configure the AutoSale name, support email, homepage, privacy policy, terms, authorized domain, and current developer contacts before requesting verification.

## Picker key

Create a separate browser API key for Picker. Restrict it to the Google Picker API and the exact production web origin. The key identifies the project but does not authorize spreadsheet access.

## Runtime secrets

- `GOOGLE_OAUTH_CLIENT_ID`: server OAuth client ID.
- `GOOGLE_OAUTH_CLIENT_SECRET`: server-only secret.
- `GOOGLE_OAUTH_REDIRECT_URI`: exact registered callback.
- `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`: browser client identifier used by Picker.
- `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`: origin/API-restricted Picker key.

Store server secrets in deployment secret storage or `.env` outside Git. Never put a refresh token, client secret, authorization code, or spreadsheet contents in logs, images, CI artifacts, or browser storage.

## Staging verification

Use a private test spreadsheet. The owner must authorize Google, select that file through Picker, list its tabs, import a catalogue, and export one order. Then revoke the grant and confirm AutoSale requests reconnection without losing internal products or orders.
