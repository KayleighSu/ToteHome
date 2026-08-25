# ToteHome

An Expo/React Native prototype for cataloging storage totes across shared households.

## Included

- Multiple household switching
- Automatic household-specific tote numbers
- Locations and shelf details
- Manual item entry and quantities
- Search across every household
- QR label scanning
- Two-copy printable label PDFs
- Local saving between launches

## Preview from Windows

1. Open this folder in VS Code.
2. Run `npm start` in the terminal.
3. Install Expo Go on the iPhone.
4. Scan the QR code from Expo. Keep the PC and iPhone on the same network.

Run `npm run web` for a browser preview.

## Cloud accounts

`supabase-schema.sql` contains the production data model, automatic empty-household creation, and household-level access rules. Create a Supabase project, run that file in its SQL editor, copy `.env.example` to `.env`, and add the project URL and public anon key. Never put the service-role key in the app.

Development can remain in VS Code on Windows. Final App Store signing requires the Apple account and either a Mac with Xcode or an Expo cloud build.
