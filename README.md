# ProfElect2

ProfElect2 is an EMR-style web application built with Node.js, Express, SQLite, and Tesseract OCR.

## Features
- User registration and login for admin, doctor, and patient roles
- Patient profile creation and invite handling
- QR code generation support
- OCR and image-processing support via `tesseract.js` and `sharp`
- SQLite database storage in `data/emr.db`

## Requirements
- Node.js 18+ (or compatible)
- npm

## Installation
1. Open a terminal in the project folder.
2. Install dependencies:

```bash
npm install
```

3. Create a copy of the environment example:

```bash
copy .env.example .env
```

4. Update `.env` with your Roboflow API key if you use the ID detection feature.

## Running the app
Start the server:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Notes
- The app stores data in `data/emr.db`.
- The database file and local logs are excluded from git by `.gitignore`.
- If `data/emr.db` does not exist, SQLite will create it automatically when the app starts.

## Important files
- `server.js` — Express server and API routes
- `db.js` — SQLite database and helper functions
- `package.json` — project metadata and dependencies
- `.env.example` — sample environment variables

## GitHub repository
This project is already pushed to:

https://github.com/DhenEs26/ProfElect2.git
