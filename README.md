# stviewpub

Google Street View publisher for 360 panorama photos.

## Use

Open the web app at:

- [https://znbang.github.io/stviewpub/](https://znbang.github.io/stviewpub/)

## Features

- Select multiple JPEG panorama photos.
- Validate GPS EXIF metadata before upload.
- Publish photos to Google Street View from the web app.
- Track per-photo upload and publish status.
- Preview selected photo metadata on mobile.

## Setup

Install dependencies:

```sh
npm install
```

Run the web app:

```sh
npm run web
```

Run Expo for mobile preview:

```sh
npm start
```

## Build

Build the web app:

```sh
npx expo export --platform web
```

The static web output is written to `dist/`.

## Deployment

This repository includes a GitHub Actions workflow for GitHub Pages deployment.

Before using the deployed app, configure the Google OAuth client with the GitHub Pages origin:

- `https://znbang.github.io`

Do not commit OAuth client secrets.

## Checks

```sh
npm run typecheck
npx expo export --platform web
```
