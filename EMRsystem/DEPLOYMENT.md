# Deployment: Neon + Render + Vercel

This app uses:

- Neon for Postgres
- Render for the Node/Express API
- Vercel for the static HTML/CSS/JS frontend

## 1. Neon

1. Create a Neon project.
2. Copy the pooled or direct Postgres connection string.
3. Keep it ready as `DATABASE_URL`.

Example:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require
```

## 2. Render API

1. Create a new Render Web Service from this GitHub repo.
2. Set the root directory to:

```text
EMRsystem
```

3. Use:

```text
Build Command: npm install
Start Command: npm start
Health Check Path: /api/health
```

4. Add environment variables:

```env
DATABASE_URL=your_neon_connection_string
FRONTEND_URL=https://your-vercel-app.vercel.app
ROBOFLOW_API_KEY=your_key_if_you_use_ocr_detection
```

5. Deploy and copy the Render URL, for example:

```text
https://emrsystem-api.onrender.com
```

## 3. Vercel Frontend

1. Open `api-config.js`.
2. Replace:

```js
https://YOUR-RENDER-SERVICE.onrender.com
```

with your real Render URL.

3. Create a new Vercel project from this repo.
4. Set the root directory to:

```text
VercelFrontend
```

5. Set:

```text
Build Command: leave blank
Output Directory: leave blank
```

6. Deploy.
7. Go back to Render and set `FRONTEND_URL` to the final Vercel URL.

## 4. Local Development

Create `.env` from `.env.example`, then run:

```powershell
cd C:\Users\Diony\Documents\ProfElect2-master\EMRsystem
npm install
npm start
```

Local pages automatically call:

```text
http://localhost:3000
```

Deployed Vercel pages call the Render URL configured in `api-config.js`.
