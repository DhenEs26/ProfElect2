# ProfElect2 Requirements

## System Requirements
- Node.js 18 or newer
- npm 9 or newer
- Python 3.8+ (for OCR/ML features if needed)

## Installation Steps

### 1. Install Node.js dependencies
```bash
npm install
```

### 2. Environment Configuration
```bash
copy .env.example .env
```
Then edit `.env` to add your configuration:
- `ROBOFLOW_API_KEY` - for OCR/ID detection features
- Database credentials
- API keys and secrets

### 3. Start the server
```bash
npm start
```
Server will run on http://localhost:3000

## Core Dependencies (from package.json)
- express - Web framework
- cors - Cross-Origin Resource Sharing
- dotenv - Environment variables
- bcryptjs - Password hashing
- form-data - Form submission handling
- qrcode - QR code generation
- sharp - Image processing
- sqlite3 - Database
- tesseract.js - OCR (client-side)
- tesseract.js-core - OCR core library

## Optional Python Dependencies
```bash
# For enhanced OCR features
pip install pytesseract pillow opencv-python
```

## Large Files (Not Included in Repository)
- `eng.traineddata` - Tesseract OCR training data
- `national_ID_fake/` - Sample ID images for testing
- `national_ID_orig/` - Original ID documents (if applicable)

See `.gitignore` for files excluded from version control.
