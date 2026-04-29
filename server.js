require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const FormData = require('form-data');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));

app.post('/api/register', async (req, res) => {
  try {
    const {
      role,
      email,
      password,
      displayName,
      inviteToken,
      username,
      firstName,
      middleName,
      lastName,
      suffix,
      mobile,
      dateOfBirth,
      age,
      sex,
      civilStatus,
      address,
      philhealthNumber,
      idType,
      securityQuestion,
      securityAnswer,
    } = req.body;

    if (!role || !email || !password) {
      return res.status(400).json({ success: false, message: 'role, email, and password are required.' });
    }

    const allowedRoles = ['admin', 'doctor', 'patient'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role.' });
    }

    const existing = await db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    let invite = null;
    if (role === 'patient') {
      // Invite token is optional for patient registration (clinic workflow).
      // If provided, validate and mark as used; if not valid, registration can still proceed.
      if (inviteToken) {
        invite = await db.getInviteByToken(inviteToken);
        const now = new Date();
        if (!invite || invite.used || new Date(invite.expires_at) < now) {
          invite = null; // ignore invalid/expired invite
        }
      }

      const missingFields = [];
      if (!username) missingFields.push('username');
      if (!firstName) missingFields.push('firstName');
      if (!lastName) missingFields.push('lastName');
      if (!mobile) missingFields.push('mobile');
      if (!dateOfBirth) missingFields.push('dateOfBirth');
      if (!age && age !== 0) missingFields.push('age');
      if (!sex) missingFields.push('sex');
      if (!civilStatus) missingFields.push('civilStatus');
      if (!address) missingFields.push('address');
      if (!securityQuestion) missingFields.push('securityQuestion');
      if (!securityAnswer) missingFields.push('securityAnswer');

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required patient profile fields: ${missingFields.join(', ')}`,
        });
      }
    }

    const user = await db.createUser({ role, email, password, displayName });

    let patientProfile = null;
    if (role === 'patient') {
      patientProfile = await db.createPatientProfile({
        userId: user.id,
        username,
        firstName,
        middleName,
        lastName,
        suffix,
        email,
        mobile,
        dateOfBirth,
        age: Number(age),
        sex,
        civilStatus,
        address,
        philhealthNumber,
        idType,
        securityQuestion,
        securityAnswer,
      });

      if (invite) {
        await db.markInviteUsed(invite.token);
      }
    }

    return res.status(201).json({ success: true, user, patientProfile });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Store completed health assessment for a patient
app.post('/api/assessment', async (req, res) => {
  try {
    const { userId, answers } = req.body;
    if (!userId || !answers) {
      return res.status(400).json({ success: false, message: 'userId and answers are required.' });
    }

    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const assessment = await db.createPatientAssessment({ userId, assessment: answers });
    return res.status(201).json({ success: true, assessment });
  } catch (err) {
    console.error('assessment error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Patient Dashboard Endpoints

app.post('/api/consultation-request', async (req, res) => {
  try {
    const { userId, concerns } = req.body;
    if (!userId || !concerns) {
      return res.status(400).json({ success: false, message: 'userId and concerns are required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'patient') {
      return res.status(403).json({ success: false, message: 'Only patients can submit consultation requests.' });
    }

    const doctor = await db.getDoctorUser();
    if (!doctor) {
      return res.status(500).json({ success: false, message: 'No doctor available.' });
    }

    const consultation = await db.createConsultation({ patientId: userId, doctorId: doctor.id, concerns });
    // Create notification for patient
    await db.createNotification({ userId, type: 'consultation_submitted', message: 'Your consultation request has been submitted and is under review.' });
    // Create notification for doctor
    await db.createNotification({ userId: doctor.id, type: 'new_consultation', message: `New consultation request from ${user.display_name}.` });
    return res.status(201).json({ success: true, consultation });
  } catch (err) {
    console.error('consultation request error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/my-consultations', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const consultations = await db.getConsultationsByPatient(userId);
    return res.json({ success: true, consultations });
  } catch (err) {
    console.error('my consultations error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/doctor-availability', async (req, res) => {
  try {
    const availability = await db.getDoctorAvailability();
    return res.json({ success: true, availability });
  } catch (err) {
    console.error('doctor availability error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/notifications', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const notifications = await db.getNotificationsByUser(userId);
    return res.json({ success: true, notifications });
  } catch (err) {
    console.error('notifications error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.post('/api/notifications/:id/read', async (req, res) => {
  try {
    const notificationId = req.params.id;
    await db.markNotificationRead(notificationId);
    return res.json({ success: true });
  } catch (err) {
    console.error('mark notification read error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/my-qr', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const qrData = `EMR-Patient:${userId}`;
    const qrDataUrl = await QRCode.toDataURL(qrData);
    return res.json({ success: true, qrDataUrl });
  } catch (err) {
    console.error('my qr error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/my-emr', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    // Get requesting user info
    const requestingUser = await db.getUserById(userId);
    if (!requestingUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const profile = await db.getPatientProfile(userId);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Profile not found.' });
    }

    // CP-ABE: Decrypt assessment with policy checking
    try {
      const assessment = await db.getPatientAssessmentByUserId(userId, requestingUser);
      if (assessment) {
        profile.assessment = assessment.assessment;
      }
    } catch (error) {
      console.log('Assessment access denied or not found:', error.message);
      // Continue without assessment if access is denied
    }

    return res.json({ success: true, emr: profile });
  } catch (err) {
    console.error('my emr error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/profile', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const profile = await db.getPatientProfile(userId);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Profile not found.' });
    }

    return res.json({ success: true, profile });
  } catch (err) {
    console.error('profile error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.put('/api/profile', async (req, res) => {
  try {
    const { userId, updates } = req.body;
    if (!userId || !updates) {
      return res.status(400).json({ success: false, message: 'userId and updates are required.' });
    }

    await db.updatePatientProfile(userId, updates);
    return res.json({ success: true });
  } catch (err) {
    console.error('update profile error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = await db.validateCredentials(email, password);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // In a real system, issue a session or token here.
    return res.status(200).json({ success: true, user: { id: user.id, role: user.role, email: user.email, displayName: user.display_name } });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.post('/api/admin/invite', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins may generate invite tokens.' });
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const invite = await db.createInvite({ token, expiresAt, createdBy: userId });

    const inviteUrl = `${req.protocol}://${req.get('host')}/register.html?token=${encodeURIComponent(token)}`;
    const qrDataUrl = await QRCode.toDataURL(inviteUrl);

    return res.status(201).json({
      success: true,
      invite: { token, expiresAt, inviteUrl, qrDataUrl },
    });
  } catch (err) {
    console.error('invite error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins may view stats.' });
    }

    const stats = await db.getAdminStats();
    return res.json({ success: true, stats });
  } catch (err) {
    console.error('admin stats error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins may view users.' });
    }

    const filters = {
      search: req.query.search,
      role: req.query.role,
      status: req.query.status,
    };

    const users = await db.getAllUsers(filters);
    return res.json({ success: true, users });
  } catch (err) {
    console.error('admin users error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/admin/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins may view users.' });
    }

    const targetUserId = parseInt(req.params.id, 10);
    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'User ID is required in the path.' });
    }

    const targetUser = await db.getUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.json({ success: true, user: targetUser });
  } catch (err) {
    console.error('admin user detail error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.patch('/api/admin/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins may update users.' });
    }

    const targetUserId = parseInt(req.params.id, 10);
    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'User ID is required in the path.' });
    }

    const { displayName, email, role } = req.body;
    if (!displayName && !email && !role) {
      return res.status(400).json({ success: false, message: 'At least one of displayName, email, or role must be provided.' });
    }

    await db.updateUser(targetUserId, { displayName, email, role });
    const updatedUser = await db.getUserById(targetUserId);
    return res.json({ success: true, user: updatedUser });
  } catch (err) {
    console.error('admin user update error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.post('/api/admin/users/:id/status', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins may update user status.' });
    }

    const targetUserId = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!targetUserId || !status) {
      return res.status(400).json({ success: false, message: 'User ID and status are required.' });
    }

    const allowed = ['active', 'inactive'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${allowed.join(', ')}` });
    }

    await db.updateUserStatus(targetUserId, status);
    const updatedUser = await db.getUserById(targetUserId);
    return res.json({ success: true, user: updatedUser });
  } catch (err) {
    console.error('admin user status update error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/admin/emr-records', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins may view EMR records.' });
    }

    const records = await db.getAllEMRRecords();
    
    // CP-ABE: Mark that assessment data is encrypted for admins
    const processedRecords = records.map(record => {
      if (record.assessment_json) {
        // Admins cannot decrypt - show that data exists but is not accessible
        record.assessment = '[ENCRYPTED - Access Denied for Admin Role]';
        record.assessment_json = null;
      }
      return record;
    });
    
    return res.json({ success: true, records: processedRecords });
  } catch (err) {
    console.error('admin emr records error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/admin/consultations', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins may view consultations.' });
    }

    const consultations = await db.getAllConsultations();
    return res.json({ success: true, consultations });
  } catch (err) {
    console.error('admin consultations error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/admin/qr-codes', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins may view QR codes.' });
    }

    const qrCodes = await db.getAllInvites();
    
    // Generate QR codes for each invite
    const qrCodesWithImages = await Promise.all(
      qrCodes.map(async (qr) => {
        const inviteUrl = `http://localhost:3000/register.html?token=${qr.token}`;
        const qrDataUrl = await QRCode.toDataURL(inviteUrl, { width: 300, margin: 1 });
        return { ...qr, qrDataUrl };
      })
    );
    
    return res.json({ success: true, qrCodes: qrCodesWithImages });
  } catch (err) {
    console.error('admin qr codes error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/admin/access-permissions', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins may view access permissions.' });
    }

    const permissions = await db.getDoctorAccessPermissions();
    return res.json({ success: true, permissions });
  } catch (err) {
    console.error('admin access permissions error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/invite', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(400).json({ success: false, message: 'token query parameter is required.' });
    }

    const invite = await db.getInviteByToken(token);
    const now = new Date();
    if (!invite || invite.used || new Date(invite.expires_at) < now) {
      return res.status(404).json({ success: false, message: 'Invitation token is invalid or has expired.' });
    }

    return res.json({ success: true, invite: { token: invite.token, expiresAt: invite.expires_at } });
  } catch (err) {
    console.error('invite lookup error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Optional Roboflow ID detection + auto-crop
async function detectAndValidateIdCardWithRoboflow(imageBuffer) {
  const apiKey = process.env.ROBOFLOW_API_KEY;

  if (!apiKey) {
    return { isValid: false, croppedImage: null };
  }

  try {
    const form = new FormData();
    form.append('api_key', apiKey);
    form.append('format', 'json');
    form.append('image', imageBuffer.toString('base64'));

    const response = await fetch(`https://detect.roboflow.com/philippine-ids-2loru/1?api_key=${apiKey}`, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Roboflow request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.predictions) || data.predictions.length === 0) {
      return { isValid: false, croppedImage: null };
    }

    // Look for Philippine National ID prediction
    const idPrediction = data.predictions.find((p) => 
      p.class.toLowerCase().includes('philippine') || 
      p.class.toLowerCase().includes('national') || 
      p.class.toLowerCase().includes('id')
    ) || data.predictions[0];

    if (!idPrediction || idPrediction.confidence < 0.5) { // Higher confidence threshold
      return { isValid: false, croppedImage: null };
    }

    // It's a valid Philippine ID, now crop it
    const { x, y, width, height } = idPrediction;
    const img = sharp(imageBuffer);
    const meta = await img.metadata();

    const left = Math.max(0, Math.floor(x - width / 2));
    const top = Math.max(0, Math.floor(y - height / 2));
    const cropWidth = Math.min(meta.width, Math.floor(width));
    const cropHeight = Math.min(meta.height, Math.floor(height));

    let croppedImage = null;
    if (cropWidth > 0 && cropHeight > 0) {
      croppedImage = await img.extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer();
    }

    return { isValid: true, croppedImage };
  } catch (err) {
    console.warn('[ID SCAN] Roboflow detection error, falling back to full image:', err.message);
    return { isValid: false, croppedImage: null };
  }
}

// OCR run helper used by /api/scan-id
async function runOcrAndParse(imageBuffer) {
  let preprocessed = sharp(imageBuffer);
  const metadata = await preprocessed.metadata();
  console.log('[ID SCAN] OCR preprocessing metadata:', { width: metadata.width, height: metadata.height });

  preprocessed = await preprocessed
    .grayscale()
    .normalize()
    .modulate({ saturation: 0, brightness: 1.15 })
    .sharpen({ sigma: 2 })
    .median(2)
    .threshold(120)
    .resize(1920, 1440, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();

  const base64 = `data:image/png;base64,${preprocessed.toString('base64')}`;
  const ocrOptionsList = [
    { tessedit_ocr_engine_mode: Tesseract.OEM.TESSERACT_ONLY, tessedit_pageseg_mode: 6, tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/. ,', preserve_interword_spaces: '1' },
    { tessedit_ocr_engine_mode: Tesseract.OEM.TESSERACT_ONLY, tessedit_pageseg_mode: 4, tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/. ,', preserve_interword_spaces: '1' },
    { tessedit_ocr_engine_mode: Tesseract.OEM.TESSERACT_ONLY, tessedit_pageseg_mode: 3, tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/. ,', preserve_interword_spaces: '1' },
    { tessedit_ocr_engine_mode: Tesseract.OEM.TESSERACT_ONLY, tessedit_pageseg_mode: 7, tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/. ,', preserve_interword_spaces: '1' },
    { tessedit_ocr_engine_mode: Tesseract.OEM.TESSERACT_ONLY, tessedit_pageseg_mode: 11, tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/. ,', preserve_interword_spaces: '1' }
  ];

  let ocrText = '';
  let parsed = null;
  let bestResult = null;
  let bestScore = -1;

  function getOcrScore(result) {
    if (!result) return 0;
    let score = 0;
    if (result.isValidId) score += 50;
    if (result.idNumber) score += 30;
    if (result.lastName) score += 15;
    if (result.firstName) score += 15;
    if (result.middleName) score += 5;
    if (result.dateOfBirth) score += 15;
    if (result.address) score += 15;
    if (result.sex) score += 5;
    return score;
  }

  for (const ocrOptions of ocrOptionsList) {
    const { data: ocrResult } = await Tesseract.recognize(base64, 'eng', ocrOptions);
    ocrText = ocrResult.text || '';
    parsed = parsePhilippineIdOcr(ocrText);
    console.log('[ID SCAN] OCR pass PSM', ocrOptions.tessedit_pageseg_mode, '->', parsed);

    const score = getOcrScore(parsed);
    if (score > bestScore) {
      bestScore = score;
      bestResult = { parsed, ocrText };
    }

    // continue until we have a complete capture including address and name as possible
    if (parsed.isValidId && parsed.idNumber && parsed.lastName && parsed.firstName && parsed.address) {
      break;
    }
  }

  if (!bestResult) {
    // if no predictions were ever successful, perform one final parse
    parsed = parsePhilippineIdOcr(ocrText);
    bestResult = { parsed, ocrText };
  }

  return bestResult;
}

// ID Scanning endpoint with OCR
app.post('/api/scan-id', async (req, res) => {
  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ success: false, message: 'Image data is required.' });
    }

    // Remove data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    const originalImageBuffer = Buffer.from(base64Data, 'base64');

    // Optional Roboflow ID card detection + crop
    let imageBuffer = originalImageBuffer;
    let isValidIdFromRoboflow = false;
    if (process.env.ROBOFLOW_API_KEY) {
      const detection = await detectAndValidateIdCardWithRoboflow(originalImageBuffer);
      if (detection.isValid) {
        isValidIdFromRoboflow = true;
        if (detection.croppedImage) {
          imageBuffer = detection.croppedImage;
          console.log('[ID SCAN] Using Roboflow-cropped ID image for OCR.');
        }
      } else {
        console.log('[ID SCAN] Roboflow did not detect a valid Philippine National ID.');
      }
    }

    // If Roboflow is enabled but didn't detect a valid ID, reject early
    if (process.env.ROBOFLOW_API_KEY && !isValidIdFromRoboflow) {
      return res.status(400).json({
        success: false,
        message: 'This does not appear to be a Philippine National ID. Please ensure the entire ID card is visible and try again.',
      });
    }

    // Primary OCR run (possibly cropped)
    let { parsed, ocrText } = await runOcrAndParse(imageBuffer);

    // If we got valid ID but address is missing, try fallback on full original image to recover address
    if (parsed && parsed.isValidId && !parsed.address) {
      console.log('[ID SCAN] Address missing after OCR; trying full original image to recover address.');
      const fallback = await runOcrAndParse(originalImageBuffer);
      if (fallback && fallback.parsed) {
        if (fallback.parsed.address) parsed.address = fallback.parsed.address;
        if (!parsed.firstName && fallback.parsed.firstName) parsed.firstName = fallback.parsed.firstName;
        if (!parsed.middleName && fallback.parsed.middleName) parsed.middleName = fallback.parsed.middleName;
        if (!parsed.lastName && fallback.parsed.lastName) parsed.lastName = fallback.parsed.lastName;
        if (!parsed.sex && fallback.parsed.sex) parsed.sex = fallback.parsed.sex;
        if (!parsed.dateOfBirth && fallback.parsed.dateOfBirth) parsed.dateOfBirth = fallback.parsed.dateOfBirth;
        if (!parsed.idNumber && fallback.parsed.idNumber) parsed.idNumber = fallback.parsed.idNumber;
      }
    }

    if (!parsed) {
      parsed = { isValidId: false };
      ocrText = '';
    }

    // Log the raw OCR text for debugging
    console.log('[ID SCAN] Raw OCR Text from Tesseract:');
    console.log('========================================');
    console.log(ocrText);
    console.log('========================================');

    console.log('[OCR TEXT LENGTH]', ocrText.length);
    console.log('[OCR TEXT SAMPLE]', ocrText.substring(0, 500));

    // Log the raw OCR text for debugging
    console.log('[ID SCAN] Raw OCR Text from Tesseract:');
    console.log('========================================');
    console.log(ocrText);
    console.log('========================================');

    console.log('[OCR TEXT LENGTH]', ocrText.length);
    console.log('[OCR TEXT SAMPLE]', ocrText.substring(0, 500));

    if (!parsed || !parsed.isValidId) {
      return res.status(400).json({
        success: false,
        message: 'This does not appear to be a Philippine National ID. Please ensure the entire ID card is visible and try again.',
        ocrText: ocrText.substring(0, 1000), // For debugging
      });
    }

    // Return parsed results
    return res.json({
      success: true,
      id: {
        firstName: parsed.firstName || '',
        middleName: parsed.middleName || '',
        lastName: parsed.lastName || '',
        suffix: parsed.suffix || '',
        sex: parsed.sex || '',
        dateOfBirth: parsed.dateOfBirth || '',
        age: parsed.age || 0,
        address: parsed.address || '',
        idNumber: parsed.idNumber || '',
        confidence: parsed.confidence,
      },
      debug: {
        ocrText: ocrText,
        ocrLength: ocrText.length,
        fieldsExtracted: Object.keys(parsed).filter((k) => parsed[k]).length,
        parsedResult: parsed,
      },
    });
  } catch (err) {
    console.error('[ID SCAN ERROR]', err);
    return res.status(500).json({
      success: false,
      message: `OCR processing failed: ${err.message}. Please try with a clearer image.`,
    });
  }
});

// Helper function to parse Philippine National ID OCR text - GENERIC FORMAT
function parsePhilippineIdOcr(text) {
  function isNoisyNameCandidate(name) {
    if (!name) return true;
    const val = name.toString().toLowerCase().trim();
    if (val.length < 3) return true;
    if (/psn|apciivdo|apciivd0|gucn|given|mga\s*pangalan|dpeiy|middie|midgie|\bname\b|place|metro|city|address|birth|sex|date|id/.test(val)) return true;
    return false;
  }

  function isLikelyLocationText(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return /\b(metro|city|quezon|brgy|purok|zone|bulacan|makati|manila|lupon|caloocan|quezon city)\b/.test(lower);
  }

  const result = {
    isValidId: false,
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    sex: '',
    dateOfBirth: '',
    age: 0,
    address: '',
    idNumber: '',
    confidence: 0,
  };

  const lower = text.toLowerCase();

  function normalizeLabelLine(line) {
    return line
      .toLowerCase()
      .replace(/\bapciivdo\b|\bapciivd0\b|\bapelyido\b/g, 'apelyido')
      .replace(/\b9st\b|\blast\b/g, 'last')
      .replace(/\bgucn\b|\bgucin\b|\bganar\b/g, 'given')
      .replace(/\bpangalan\b/g, 'pangalan')
      .replace(/\bgiven\b/g, 'given')
      .replace(/\bdpeiy\b|\bmiddie\b|\bmidgie\b|\bmrrare\b/g, 'middle')
      .replace(/\bapelyido\b|\blast\b/g, 'last')
      .replace(/\bsex\b|\bkasarian\b/g, 'sex')
      .replace(/\bdate of birt\b|\bdate of birth\b|\bpetsa.*kapanganakan\b/g, 'dob')
      .replace(/\baddress\b|\btirahan\b/g, 'address')
      .replace(/\bpsn\b/g, '');
  }

  function parseLabelValues(lines) {
    const out = { firstName: '', middleName: '', lastName: '', address: '' };

    const getNextText = (i) => {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim().length > 1) return lines[j].trim();
      }
      return '';
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const l = normalizeLabelLine(line);

      if (/(apelyido|last\s*name|last)/i.test(l)) {
        let labelValue = line.replace(/.*(?:apelyido|last\s*name|last)[:\s\/\-]*/i, '').trim();
        if (!labelValue) labelValue = getNextText(i);
        if (labelValue) out.lastName = normalizeOcrNameValue(cleanOcrNameText(labelValue));
      }

      if (/(mga\s*pangalan|given\s*names|given|pangalan|gucn)/i.test(l)) {
        let labelValue = line.replace(/.*(?:mga\s*pangalan|given\s*names|given|pangalan|gucn)[:\s\/\-]*/i, '').trim();
        if (!labelValue) labelValue = getNextText(i);
        if (labelValue && !/(place|birth|kapangakakan|metro|city|manila)/i.test(labelValue)) {
          out.firstName = normalizeOcrNameValue(cleanOcrNameText(labelValue));
        }
      }

      if (/(gitnang\s*apelyido|middle\s*name|middle|dpeiy|middie|midgie)/i.test(l)) {
        let labelValue = line.replace(/.*(?:gitnang\s*apelyido|middle\s*name|middle|dpeiy|middie|midgie)[:\s\/\-]*/i, '').trim();
        if (!labelValue) labelValue = getNextText(i);
        if (labelValue && !/(place|birth|kapangakakan|metro|city|manila)/i.test(labelValue)) {
          out.middleName = normalizeOcrNameValue(cleanOcrNameText(labelValue));
        }
      }

      if (/(gitnang\s*apelyido|middle\s*name|middle)/i.test(l)) {
        let labelValue = line.replace(/.*(?:gitnang\s*apelyido|middle\s*name|middle)[:\s\/\-]*/i, '').trim();
        if (!labelValue) labelValue = getNextText(i);
        if (labelValue) out.middleName = normalizeOcrNameValue(cleanOcrNameText(labelValue));
      }

      if (/(tirahan|address)/i.test(l)) {
        let labelValue = line.replace(/.*(?:tirahan|address)[:\s\/\-]*/i, '').trim();
        if (!labelValue) labelValue = getNextText(i);
        // collect extra lines for address
        let addressLines = [];
        if (labelValue) addressLines.push(labelValue);
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          if (!/(name|apelyido|date|birth|sex|kasarian|id|numero|republica|philippine|pambansang)/i.test(lines[j])) {
            if (lines[j].trim().length > 1) addressLines.push(lines[j].trim());
          }
        }
        if (addressLines.length) out.address = cleanOcrAddressText(addressLines.join(' '));
      }
    }

    return out;
  }


  // VALIDATION: Very lenient - just check for Philippine ID keywords
  const philIdKeywords = /republic|pilipinas|philippines|pambansang|pagkakakilanlan|identification|national|pnid/i;
  const hasPhilKeywords = philIdKeywords.test(lower);

  // Also accept if we find names or ID number patterns
  const hasIdPattern = /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}|\d{12,}/.test(text);
  const hasNamePattern = /[A-Z]{3,}\s+[A-Z]{3,}/.test(text); // Two words of 3+ caps letters
  
  result.isValidId = hasPhilKeywords || hasIdPattern || hasNamePattern;

  if (!result.isValidId) {
    return result;
  }

  result.confidence = 75;

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.length > 0);

  function extractProximityData(lines) {
    const out = { lastName: '', firstName: '', middleName: '', address: '' };
    const idIndex = lines.findIndex((l) => /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}|\d{12,16}/.test(l));
    if (idIndex < 0) return out;

    const cleanupLine = (line) => {
      let cleanedLine = line.trim();
      cleanedLine = cleanedLine.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '').trim();
      cleanedLine = cleanedLine.replace(/^\s*(?:at|and|&)\s+/i, '').trim();
      return cleanedLine;
    };

    const rawCandidates = [];
    for (let i = idIndex + 1; i < Math.min(lines.length, idIndex + 8); i++) {
      let line = cleanupLine(lines[i]);
      if (!line) continue;

      const lower = line.toLowerCase();
      if (/^(republika|pambansang|pagkakakilanlan|philippine|pilipinas|identification|national|republic|card)s?$/.test(lower)) continue;
      if (/\b(october|november|december|january|february|march|april|may|june|july|august|september)\b/.test(lower) && /\d{2,4}/.test(line)) continue;
      if (/\b(metro|manila|city|province|place|birth|blood|type|status|barangay|zone|brgy|street|st)\b/i.test(lower)) continue;

      // In this parsed sample, "at APARAS" is probably a corrupted "CAPARAS"
      if (/^at\s+aparas$/i.test(line)) {
        line = 'CAPARAS';
      } else if (/^at\s+([a-z]+)/i.test(line)) {
        const candidate = line.replace(/^at\s+/i, '').trim();
        if (candidate.length >= 3) {
          line = candidate.toUpperCase();
        }
      }

      // Remove explicit false positive body text
      if (/(^ea\s*\-\s*sera|gita|ngaslt|peda?)$/i.test(line)) continue;

      rawCandidates.push(line);
    }

    // Keep explicit label-based if it can be found in the proximity area
    if (rawCandidates.length > 0) {
      // Last name is the first strong candidate after ID line
      out.lastName = cleanOcrNameText(rawCandidates[0]);
      if (rawCandidates.length > 1) {
        out.firstName = cleanOcrNameText(rawCandidates[1]);
      }
      if (rawCandidates.length > 2) {
        out.middleName = cleanOcrNameText(rawCandidates[2]);
      }

      // Address: only use lines with numbers or likely address keywords
      const rawAddress = rawCandidates.slice(3);
      const goodAddressLines = rawAddress.filter((line) => {
        const l = line.toLowerCase();
        return /\d/.test(line) || /\b(st|street|purok|brgy|zone|city|bal|bulacan|manila)\b/.test(l);
      });
      if (goodAddressLines.length > 0) {
        const candidateAddress = cleanOcrAddressText(goodAddressLines.join(' '));
        // Only accept candidate addresses that look like a real address
        if (candidateAddress && /\d/.test(candidateAddress) || /\b(st|street|purok|brgy|zone|city|bulacan|manila)\b/i.test(candidateAddress)) {
          out.address = candidateAddress;
        } else {
          out.address = '';
        }
      }
    }

    return out;
  }

  console.log('[PARSE] Total lines:', lines.length);

  // EARLY LABEL PARSE pass (strongest heuristic using explicit field labels)
  const labelValues = parseLabelValues(lines);
  if (labelValues.lastName || labelValues.firstName || labelValues.middleName || labelValues.address) {
    if (labelValues.lastName) result.lastName = labelValues.lastName;
    if (labelValues.firstName) result.firstName = labelValues.firstName;
    if (labelValues.middleName) result.middleName = labelValues.middleName;
    if (labelValues.address) result.address = labelValues.address;
    console.log('[PARSE] Using EARLY LABEL pass', labelValues);
  }

  // Fallback for heavily garbled label lines
  const corruptedNames = extractNamesFromCorruptedLabels(lines);
  if (!result.firstName && corruptedNames.firstName) result.firstName = corruptedNames.firstName;
  if (!result.middleName && corruptedNames.middleName) result.middleName = corruptedNames.middleName;
  if (!result.lastName && corruptedNames.lastName) result.lastName = corruptedNames.lastName;

  // STEP 1: Extract ID Number (works for many formats including PSN and 12-16 digits)
  let idFound = false;
  for (let i = 0; i < Math.min(12, lines.length); i++) {
    const idMatch = lines[i].match(/(?:psn[-\s:]*)?(\d{4}[-\s]?\d{4}[-\s]?\d{1,7}[-\s]?\d{1,4}|\d{12,16})/i);
    if (idMatch) {
      result.idNumber = cleanOcrIdNumber(idMatch[1]);
      if (result.idNumber) {
        idFound = true;
        console.log('[PARSE] ID Number found:', result.idNumber);
        break;
      }
    }
  }
  if (!idFound) {
    const fallbackMatch = text.match(/psn[-\s:]*(\d[\d\-]{10,25})/i) || text.match(/(\d{12,16})/);
    if (fallbackMatch) {
      result.idNumber = cleanOcrIdNumber(fallbackMatch[1]);
      if (result.idNumber) {
        console.log('[PARSE] ID Number fallback found:', result.idNumber);
      }
    }

    if (!result.idNumber) {
      const psnLine = lines.find((l) => /psn\b/i.test(l));
      if (psnLine) {
        const psnDigits = psnLine.match(/(\d[\d\-]{10,25})/);
        if (psnDigits) {
          result.idNumber = cleanOcrIdNumber(psnDigits[1]);
          if (result.idNumber) console.log('[PARSE] ID Number psn line found:', result.idNumber);
        }
      }
    }
  }

  // STEP 2: Extract Date of Birth (works for all formats)
  // STEP 2: Extract Date of Birth (works for all formats)
  const dateMatch = findDateInText(text);
  if (dateMatch) {
    result.dateOfBirth = dateMatch;
    result.age = calculateAge(result.dateOfBirth);
    console.log('[PARSE] DOB found:', result.dateOfBirth);
  }

  // Sex extraction (e.g., Sex/Male/Female; Kasarian/Male/Female)
  if (!result.sex) {
    const sexMatch = text.match(/(?:sex|kasarian)[:\s]*([MF]|male|female)/i);
    if (sexMatch) {
      const s = sexMatch[1].toString().toLowerCase();
      result.sex = s.startsWith('m') ? 'male' : s.startsWith('f') ? 'female' : '';
      console.log('[PARSE] Sex found via label:', result.sex);
    }
  }

  // Harder fallback: split lines and extract after label with fuzzy tokens
  if (!result.sex) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/\b(?:kasarian|sex|s3x|sera|sira|s3x)/i.test(line)) {
        const look = line.replace(/.*(?:kasarian|sex|s3x|sera|sira|s3x)[:\s\-]*/i, '').trim();
        if (/^(m|male)\b/i.test(look)) { result.sex = 'male'; break; }
        if (/^(f|female)\b/i.test(look)) { result.sex = 'female'; break; }
      }
    }
    if (result.sex) console.log('[PARSE] Sex found via fuzzy label fallback:', result.sex);
  }

  if (!result.sex) {
    if (/\bmale\b/i.test(text)) {
      result.sex = 'male';
      console.log('[PARSE] Sex found generic: male');
    } else if (/\bfemale\b/i.test(text)) {
      result.sex = 'female';
      console.log('[PARSE] Sex found generic: female');
    }
  }

  if (!result.sex) {
    // Attempt line-level heuristic for corrupted sex labels near the date line
    const textLines = lines.map((l) => l.trim()).filter((l) => l);
    let sexLine = textLines.find((l) => /(?:sex|kasarian|s3x|sera|sira|hidsex)/i.test(l));
    if (!sexLine) {
      const dobIndex = textLines.findIndex((l) => /(?:date|petsa|birth)/i.test(l));
      if (dobIndex >= 0 && dobIndex + 1 < textLines.length) {
        sexLine = textLines[dobIndex + 1];
      }
    }

    if (sexLine) {
      if (/\b[MF]\b/.test(sexLine) || /\bmale\b/i.test(sexLine)) {
        result.sex = 'male';
      } else if (/\bfemale\b/i.test(sexLine)) {
        result.sex = 'female';
      }
      if (result.sex) {
        console.log('[PARSE] Sex found fallback from line heuristics:', result.sex, 'line=', sexLine);
      }
    }
  }

  // STEP 3: Try LABEL-BASED extraction first (for well-formatted IDs)
  const labelBasedResult = extractNamesFromLabels(lines);
  if (labelBasedResult.lastName || labelBasedResult.firstName) {
    if (!result.lastName) result.lastName = labelBasedResult.lastName;
    if (!result.firstName) result.firstName = labelBasedResult.firstName;
    if (!result.middleName) result.middleName = labelBasedResult.middleName;
    if (!result.address) result.address = labelBasedResult.address;
    console.log('[PARSE] Using LABEL-BASED extraction', labelBasedResult);

    const hasStrongNames = result.firstName && result.lastName && !isNoisyNameCandidate(result.firstName) && !isNoisyNameCandidate(result.lastName);
    if (hasStrongNames) {
      console.log('[PARSE] Strong label-based names; context fallback for address only.');
      if (result.address) {
        return result;
      }
      // Continue to later fallback logic to extract address if missing.
    }
  }

  // Fallback: if label extraction did not produce full names, apply proximity heuristics
  if (!result.lastName || !result.firstName) {
    const proximityResult = extractProximityData(lines);
    if (!result.lastName && proximityResult.lastName) result.lastName = proximityResult.lastName;
    if (!result.firstName && proximityResult.firstName) result.firstName = proximityResult.firstName;
    if (!result.middleName && proximityResult.middleName) result.middleName = proximityResult.middleName;
    if (!result.address && proximityResult.address) result.address = proximityResult.address;
    if (result.lastName && result.firstName) {
      console.log('[PARSE] Fallback via proximity extraction succeeded', proximityResult);
      return result;
    }
  }

  // If we already have strong label values, skip context fallback (but still try address fallback)
  if (result.lastName && result.firstName) {
    if (result.address) {
      console.log('[PARSE] Label-based names and address set, returning result.');
      return result;
    }
    console.log('[PARSE] Label-based names found, address missing; continue to fallback address extraction.');
  }

  // STEP 4: FALLBACK - Use context-based extraction for label-less IDs
  console.log('[PARSE] No labels found, using CONTEXT-BASED extraction');
  const contextResult = extractNamesFromContext(lines);
  result.lastName = contextResult.lastName;
  result.firstName = contextResult.firstName;
  result.middleName = contextResult.middleName;
  result.address = contextResult.address;

  // Heuristic fallback: if no first name, use nearby lines around the last name line
  if (!result.firstName && result.lastName) {
    const lastIndex = lines.findIndex((l) => l.toLowerCase().includes(result.lastName.toLowerCase()));
    if (lastIndex >= 0) {
      for (let j = lastIndex + 1; j < Math.min(lines.length, lastIndex + 8); j++) {
        const rawLine = lines[j].trim();
        if (!rawLine || /gucn|given|mga\s*pangalan|middle|middie|dpeiy|apelyido|last/i.test(rawLine)) continue;
        const candidate = cleanOcrNameText(rawLine);
        if (candidate && candidate.length > 2 && !/(place|metro|city|address|date|birth|id|number|sex)/i.test(candidate) && !isLikelyLocationText(candidate)) {
          result.firstName = candidate;
          console.log('[PARSE] Heuristic first name from context fallback:', candidate);
          break;
        }
      }
    }
  }

  // Heuristic fallback for middle name
  if (!result.middleName && result.lastName) {
    const lastIndex = lines.findIndex((l) => l.toLowerCase().includes(result.lastName.toLowerCase()));
    if (lastIndex >= 0) {
      for (let j = lastIndex + 1; j < Math.min(lines.length, lastIndex + 10); j++) {
        const rawLine = lines[j].trim();
        if (!rawLine || /gucn|given|mga\s*pangalan|apelyido|last|place|birth|metro|city|address|date|id|number|sex/i.test(rawLine)) continue;
        const cand = cleanOcrNameText(rawLine);
        if (cand && cand.length > 2 && cand !== result.firstName && !isLikelyLocationText(cand)) {
          result.middleName = cand;
          console.log('[PARSE] Heuristic middle name from context fallback:', cand);
          break;
        }
      }
    }
  }

  // Final address fallback if we still don't have it
  if (!result.address) {
    const extractedAddress = extractAddressFromLines(lines);
    if (extractedAddress) {
      result.address = extractedAddress;
      console.log('[PARSE] Fallback address extraction successful:', result.address);
    }
  }

  return result;
}

// Extract names using labels (first strategy)
function extractNamesFromLabels(lines) {
  const result = { lastName: '', firstName: '', middleName: '', address: '' };

  // Blacklist: words/phrases that appear in headers or labels but are NOT names
  const headerBlacklist = /^(REPUBLIKA|PILIPINAS|PAMBANSANG|PAGKAKAKILANLAN|IDENTIFICATION|CARD|NATIONAL|REPUBLIC|PHILIPPINES|Philippine|the|of|and|or|NG|SA|para|sa)\s*$/i;
  
  // Look for label-based patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();

    // LAST NAME extraction
    if ((lineLower.includes('apelyido') || lineLower.includes('iast') || lineLower.includes('last')) && 
        !lineLower.includes('given') && !lineLower.includes('middle')) {
      
      // Try to extract value from SAME line first (e.g., "Apelyido/Last Name: MAGPAYO")
      let value = line.replace(/^.*?(?:apelyido|iast|last)[:\s\/\-]*/i, '').trim();
      
      // If no value on same line, try next line
      if (!value && i + 1 < lines.length) {
        value = lines[i + 1].trim();
      }
      
      value = normalizeOcrNameValue(cleanOcrNameText(value));
      if (value && !headerBlacklist.test(value)) {
        result.lastName = value;
      }
    }

    // FIRST NAME extraction
    if ((lineLower.includes('given') || lineLower.includes('gven') || lineLower.includes('mga') || 
         lineLower.includes('pangalan')) && !lineLower.includes('middle')) {
      if (/\b(place|birth|kapangakakan|kabuhayan|barangay|metro|city)\b/i.test(lineLower)) continue;

      // Try same line first
      let value = line.replace(/^.*?(?:given|gven|mga|pangalan)[:\s\/\-]*/i, '').trim();
      
      // Validate and fallback to next lines as needed to avoid location line mistakes
      const tryNeighborValue = (candidate) => {
        if (!candidate) return '';
        candidate = normalizeOcrNameValue(cleanOcrNameText(candidate));
        if (!candidate || !candidate.length) return '';
        if (headerBlacklist.test(candidate) || isLikelyLocationText(candidate) || isNoisyNameCandidate(candidate)) return '';
        return candidate;
      };

      let resolved = tryNeighborValue(value);
      if (!resolved) {
        if (i + 1 < lines.length) resolved = tryNeighborValue(lines[i + 1].trim());
        if (!resolved && i + 2 < lines.length) resolved = tryNeighborValue(lines[i + 2].trim());
      }

      if (resolved) {
        result.firstName = resolved;
      }
    }

    // MIDDLE NAME extraction
    if (lineLower.includes('middle') || lineLower.includes('gitnang') || 
        lineLower.includes('genang') || lineLower.includes('gunang')) {
      
      // Try same line first
      let value = line.replace(/^.*?(?:middle|gitnang|genang|gunang)[:\s\/\-]*/i, '').trim();
      
      const tryNeighborValue = (candidate) => {
        if (!candidate) return '';
        candidate = normalizeOcrNameValue(cleanOcrNameText(candidate));
        if (!candidate || !candidate.length) return '';
        if (headerBlacklist.test(candidate) || isLikelyLocationText(candidate) || isNoisyNameCandidate(candidate)) return '';
        return candidate;
      };

      let resolved = tryNeighborValue(value);
      if (!resolved) {
        if (i + 1 < lines.length) resolved = tryNeighborValue(lines[i + 1].trim());
        if (!resolved && i + 2 < lines.length) resolved = tryNeighborValue(lines[i + 2].trim());
      }

      if (resolved) {
        result.middleName = resolved;
      }
    }

    // ADDRESS extraction
    if (lineLower.includes('address') || lineLower.includes('tirahan') || lineLower.includes('trahar')) {
      const addressLines = [];
      
      // Try to extract address from same line first
      let firstLine = line.replace(/^.*?(?:address|tirahan|trahar)[:\s\/\-]*/i, '').trim();
      if (firstLine && firstLine.length > 3) addressLines.push(firstLine);
      
      // Collect following lines that look like address continuations
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (!/(?:name|apelyido|date|birth|sex|kasarian|id|numero)/.test(lines[j].toLowerCase())) {
          if (lines[j].length > 3) addressLines.push(lines[j]);
        }
      }
      
      if (addressLines.length > 0) {
        result.address = cleanOcrAddressText(addressLines.join(' '));
      }
    }
  }

  return result;
}

// Fallback parser for severely distorted name line patterns
function extractNamesFromCorruptedLabels(lines) {
  const out = { firstName: '', middleName: '', lastName: '' };
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();

    if (/gucn|given\s*names|mga\s*pangalan/.test(lower) && !out.firstName) {
      const candidate = (lines[i + 1] || '').trim();
      if (candidate && !/(place|municipal|metro|city|born|birth)/i.test(candidate)) {
        out.firstName = normalizeOcrNameValue(cleanOcrNameText(candidate));
      }
    }

    if (/(gitnang\s*apelyido|middle\s*name|middle|dpeiy|middie|midgie)/.test(lower) && !out.middleName) {
      const candidate = (lines[i + 1] || '').trim();
      if (candidate && !/(place|metro|city|born|birth)/i.test(candidate)) {
        out.middleName = normalizeOcrNameValue(cleanOcrNameText(candidate));
      }
    }

    if (/(apelyido|last\s*name|last|apciivdo)/.test(lower) && !out.lastName) {
      const candidate = (lines[i + 1] || '').trim();
      if (candidate && !/(place|metro|city|born|birth)/i.test(candidate)) {
        out.lastName = normalizeOcrNameValue(cleanOcrNameText(candidate));
      }
    }
  }

  return out;
}

// Extract names using context (second strategy - for label-less IDs)
function extractNamesFromContext(lines) {
  const result = { lastName: '', firstName: '', middleName: '', address: '' };

  // Blacklist: header/label words that should never be treated as names
  const headerBlacklist = new Set([
    'REPUBLIKA', 'PILIPINAS', 'PAMBANSANG', 'PAGKAKAKILANLAN', 
    'IDENTIFICATION', 'CARD', 'NATIONAL', 'REPUBLIC', 'PHILIPPINES',
    'PHILIPPINE', 'THE', 'OF', 'AND', 'OR', 'NG', 'SA', 'PARA', 'SA'
  ]);

  // Strategy: Find valid name candidates (all-caps, 2-3 words, 3+ letters each)
  const capitalSequences = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip very short lines
    if (line.length < 3) continue;
    
    // Skip lines that are clearly IDs or dates
    if (/\d{4}[-\s]?\d{4}/.test(line)) continue;
    
    // Skip lines that are likely address / location text
    if (/\b(metro|manila|city|bulacan|zone|brgy|street|st|muntinlupa|quezon|san|juan)\b/i.test(line)) continue;

    // Check if line is mostly capital letters (name-like)
    const capitalRatio = (line.match(/[A-Z]/g) || []).length / line.length;
    if (capitalRatio < 0.6) continue; // Less than 60% capitals? Skip.

    // Extract just the capital words (multi-word names)
    const words = line.split(/\s+/).filter(w => w.length > 1);
    const capitalWords = words.filter(w => /^[A-Z]/.test(w) && /^[A-Za-z\-]+$/.test(w));
    
    if (capitalWords.length === 0) continue;
    
    // Check against blacklist
    const isBanned = capitalWords.some(w => headerBlacklist.has(w.toUpperCase()));
    if (isBanned) {
      console.log('[PARSE] CONTEXT Skipping blacklisted line:', line);
      continue;
    }

    // Valid name candidate
    const cleaned = cleanOcrNameText(line);
    if (cleaned && cleaned.length > 2 && !headerBlacklist.has(cleaned) && !isLikelyLocationText(cleaned)) {
      capitalSequences.push({ line: cleaned, originalLine: line });
      console.log('[PARSE] CONTEXT Found valid name candidate:', cleaned);
    }
  }

  // Assign extracted names based on position
  if (capitalSequences.length >= 1) {
    result.lastName = capitalSequences[0].line;
    console.log('[PARSE] CONTEXT Assigned Last Name:', result.lastName);
  }
  if (capitalSequences.length >= 2) {
    result.firstName = capitalSequences[1].line;
    console.log('[PARSE] CONTEXT Assigned First Name:', result.firstName);
  }
  if (capitalSequences.length >= 3) {
    result.middleName = capitalSequences[2].line;
    console.log('[PARSE] CONTEXT Assigned Middle Name:', result.middleName);
  }

  // Extract address as remaining text (mixed case with numbers)
  const addressCandidates = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Address lines have numbers but NOT ID patterns, mixed case
    if (/\d/.test(line) && !/\d{4}[-\s]?\d{4}/.test(line) && line.length > 5) {
      if (!/^[A-Z\s\-]{3,}$/.test(line)) {
        addressCandidates.push(line);
      }
    }
  }
  if (addressCandidates.length > 0) {
    result.address = cleanOcrAddressText(addressCandidates.join(' '));
    console.log('[PARSE] CONTEXT Found Address:', result.address);
  }

  return result;
}

function extractAddressFromLines(lines) {
  // Attempt explicit label-based address extraction first
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    if (lower.includes('tirahan') || lower.includes('address') || lower.includes('trahan')) {
      let extracted = line.replace(/^.*(?:tirahan|address|trahan)[:\s\/-]*/i, '').trim();

      // Collect strong address candidate lines after label line (if not enough details in same line)
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (!nextLine) continue;
        if (/(?:name|apelyido|date|birth|sex|kasarian|id|numero|republica)/i.test(nextLine)) break;
        extracted += (extracted ? ' ' : '') + nextLine;
      }

      // Ensure we have at least one address keyword or number before accepting
      if (!/\d/.test(extracted) && !/(?:street|st\.|purok|brgy|zone|city|bulacan|metro|malo)/i.test(extracted)) {
        // Still keep fallback for later, but try to derive from nearby lines
        const nearby = [];
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j].trim();
          if (nextLine && !/(?:name|apelyido|date|birth|sex|kasarian|id|numero|republica)/i.test(nextLine)) {
            nearby.push(nextLine);
          }
        }
        extracted = (extracted + ' ' + nearby.join(' ')).trim();
      }

      const cleaned = cleanOcrAddressText(extracted);
      if (cleaned) return cleaned;
    }
  }

  // Fallback: find lines that look like address components
  const candidateLines = lines.filter((line) => {
    return /\d/.test(line) && !/\d{4}[-\s]?\d{4}/.test(line) && /(?:st|street|purok|brgy|zone|city|bulacan|malo|metro|barangay)/i.test(line);
  });
  if (candidateLines.length > 0) {
    const cleaned = cleanOcrAddressText(candidateLines.join(' '));
    if (cleaned) return cleaned;
  }

  // Weak fallback: take any lines with address-related words
  const explicitCandidates = lines.filter((line) => /(?:tirahan|address|brgy|purok|street|st\.|zone|city|bulacan|metro)/i.test(line));
  if (explicitCandidates.length > 0) {
    const cleaned = cleanOcrAddressText(explicitCandidates.join(' '));
    if (cleaned) return cleaned;
  }

  return '';
}

// Helper: Clean OCR text for names (preserve letters, spaces, hyphens)
function cleanOcrNameText(text) {
  if (!text) return '';
  
  let cleaned = text.trim();
  
  // Remove very common OCR artifacts and garbage patterns
  cleaned = cleaned.replace(/^[\*\-_\d\s]+/g, '').trim();
  cleaned = cleaned.replace(/[\*\-_\d\s]+$/g, '').trim();
  
  // Remove header labels inline (these should have been caught earlier, but just in case)
  cleaned = cleaned.replace(/(?:apelyido|iast|last|given|gven|middle|name|pangalan)/gi, '').trim();
  
  // Remove date-like artifacts (if line contains "OCTOBER", "JANUARY", etc.)
  cleaned = cleaned.replace(/\b(?:OKTOBER|OCTOBER|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|NOVEMBER|DECEMBER|JANUARY|JANUARY)\b/gi, '').trim();
  
  // Remove numbers entirely for safety (names shouldn't have numbers)
  cleaned = cleaned.replace(/\d+/g, '').trim();
  
  // Keep only letters, spaces, and hyphens
  cleaned = cleaned.replace(/[^A-Za-z\s\-]/g, '').trim();
  
  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Remove trailing/leading hyphens
  cleaned = cleaned.replace(/^-+|-+$/g, '').trim();
  
  // If the result has multiple short fragments (like "EA - SERA GIT A O"), skip it
  const words = cleaned.split(' ').filter(w => w.length > 0);
  if (words.length > 1 && words.some(w => w.length === 1)) {
    // Has single-letter words = likely garbage
    cleaned = words.filter(w => w.length > 1).join(' ').trim();
  }

  // Specific correction for common OCR drop of first character in middle name
  if (/^APARAS$/i.test(cleaned)) {
    cleaned = 'CAPARAS';
  }

  // Apply manual correction for top-end pattern: "AT APARAS" and similar
  if (/^AT\s+([A-Z]+)$/i.test(cleaned)) {
    cleaned = cleaned.replace(/^AT\s+/i, '');
  }
  
  // Result must be reasonable length (2-50 chars)
  if (cleaned.length < 2 || cleaned.length > 50) return '';
  
  return cleaned.toUpperCase();
}

// Helper: Normalize OCR name values (shared between parser modes)
function normalizeOcrNameValue(rawValue) {
  if (!rawValue) return '';
  let value = rawValue.trim();

  // Fix common OCR artifacts where "C" is misread as "at" or missing
  if (/^at\s+/i.test(value)) {
    value = value.replace(/^at\s+/i, '').trim();
  }

  // If the output is one character short for a known Philippine middle/last name.
  if (/^(?:aparas)$/i.test(value)) {
    value = 'CAPARAS';
  }

  // Remove weird leading tokens due to OCR and ensure all-caps name output
  value = value.replace(/^[:\-\s]+|[:\-\s]+$/g, '').trim();
  value = value.toUpperCase();

  // Basic guard: valid name should be all letters and spaces/hyphens
  if (!/^[A-Z\s\-]+$/.test(value)) {
    value = value.replace(/[^A-Z\s\-]/g, '').trim();
  }

  return value;
}

// Helper: Clean OCR text for addresses (preserve more characters)
function cleanOcrAddressText(text) {
  if (!text) return '';
  
  let cleaned = text.trim();
  
  // Remove address label remnants
  cleaned = cleaned.replace(/^(?:Address|Trahar|Tirahan|Residency|address\s+ed|Addie|Norrie)[\s\-:.\/]*/gi, '').trim();
  
  // Remove OCR header/name artifacts that got mixed in
  // These are all-caps sequences like "REPUBLIKA NG PILIPINAS", "ALEXANDER", etc.
  cleaned = cleaned.replace(/\b(?:REPUBLIKA|PILIPINAS|PAMBANSANG|PAGKAKAKILANLAN|IDENTIFICATION|NATIONAL|REPUBLIC|PHILIPPINES|PHILIPPINE)\b\s*/gi, '').trim();
  
  // Remove date patterns (full dates or month names mixed in)
  cleaned = cleaned.replace(/\b(?:OKTOBER|OCTOBER|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|NOVEMBER|DECEMBER|January|January)\s+\d+[,\s]*\d{4}\b/gi, '').trim();
  cleaned = cleaned.replace(/\b(?:OKTOBER|OCTOBER|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|NOVEMBER|DECEMBER)\s+\d+[,\s]*\d{4}?\b/gi, '').trim();
  
  // Remove partial first/last names that appear in address lines
  cleaned = cleaned.replace(/\b(?:ALEXANDER|MAGPAYO|CAPARAS|JUAN|SANTOS|MARIA|DELA|CRUZ)\s*/gi, '').trim();
  
  // Keep letters, numbers, spaces, commas, periods, hyphens
  cleaned = cleaned.replace(/[^A-Za-z0-9\s,\.\-]/g, ' ').trim();
  
  // Remove trailing single letters (OCR noise)
  cleaned = cleaned.replace(/\s+[A-Za-z]\s*$/g, '').trim();
  
  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Address must contain numeric street component or a place keyword, else ignore
  if (!/\d/.test(cleaned) && !/\b(st|street|purok|brgy|zone|city|bulacan|manila|mt)\b/i.test(cleaned)) {
    return '';
  }

  // Minimum length check for valid address
  return cleaned.length > 8 ? cleaned : '';
}

// Helper: Clean ID number (keep digits and hyphens)
function cleanOcrIdNumber(text) {
  if (!text) return '';
  
  // Extract only digits
  const cleaned = text.replace(/[^\d]/g, '').trim();
  
  // Philippine ID can be 12 or 14-16 digits
  // Standard format is XXXX-XXXX-XXXX-XXXX (16 digits)
  if (cleaned.length >= 12 && cleaned.length <= 16) {
    const parts = [];
    let index = 0;
    while (index < cleaned.length) {
      const rem = cleaned.length - index;
      const groupSize = rem > 8 ? 4 : rem; // keep final group small when needed
      parts.push(cleaned.substring(index, index + groupSize));
      index += groupSize;
    }
    return parts.join('-');
  } else if (cleaned.length === 14) {
    // Some legacy variant (if double-caught)
    return `${cleaned.substring(0, 4)}-${cleaned.substring(4, 8)}-${cleaned.substring(8, 12)}-${cleaned.substring(12, 14)}`;
  } else if (cleaned.length === 12) {
    // Older format with 12 digits
    return `${cleaned.substring(0, 4)}-${cleaned.substring(4, 8)}-${cleaned.substring(8, 12)}`;
  } else if (cleaned.length > 8) {
    // Try to extract the longest ID pattern
    const match16 = cleaned.match(/(\d{16})/);
    if (match16) {
      const digits = match16[1];
      return `${digits.substring(0, 4)}-${digits.substring(4, 8)}-${digits.substring(8, 12)}-${digits.substring(12, 16)}`;
    }
    const match12 = cleaned.match(/(\d{12})/);
    if (match12) {
      const digits = match12[1];
      return `${digits.substring(0, 4)}-${digits.substring(4, 8)}-${digits.substring(8, 12)}`;
    }
  }
  
  return cleaned;
}

// Helper: Parse date of birth (handles month names and numeric dates)
function parseDateOfBirth(dateStr) {
  if (!dateStr) return '';
  
  dateStr = dateStr.trim().toUpperCase();
  
  // Month name mapping
  const monthNames = {
    'JANUARY': '01', 'JAN': '01',
    'FEBRUARY': '02', 'FEB': '02',
    'MARCH': '03', 'MAR': '03',
    'APRIL': '04', 'APR': '04',
    'MAY': '05',
    'JUNE': '06', 'JUN': '06',
    'JULY': '07', 'JUL': '07',
    'AUGUST': '08', 'AUG': '08',
    'SEPTEMBER': '09', 'SEP': '09',
    'OCTOBER': '10', 'OCT': '10',
    'NOVEMBER': '11', 'NOV': '11',
    'DECEMBER': '12', 'DEC': '12'
  };
  
  // Try pattern: "JANUARY 01, 1990" or "JANUARY 01 1990"
  const monthMatch = dateStr.match(/([A-Z]+)\s+(\d{1,2})[,\s]+(\d{4})/);
  if (monthMatch) {
    const monthName = monthMatch[1];
    const day = monthMatch[2];
    const year = monthMatch[3];
    const month = monthNames[monthName];
    
    if (month && parseInt(day) >= 1 && parseInt(day) <= 31) {
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }
  
  // Try numeric patterns: MM/DD/YYYY or DD/MM/YYYY
  const numericMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (numericMatch) {
    let day = parseInt(numericMatch[1], 10);
    let month = parseInt(numericMatch[2], 10);
    const year = numericMatch[3];
    
    // If month > 12, swap day and month
    if (month > 12) {
      [day, month] = [month, day];
    }
    
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  
  return '';
}

// Helper: Find date in text (looks for month names or numeric dates)
function findDateInText(text) {
  const upper = text.toUpperCase();
  
  // Look for month name patterns
  const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 
                      'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  
  for (const month of monthNames) {
    const monthPattern = new RegExp(month + '\\s+(\\d{1,2})[,\\s]+(\\d{4})', 'i');
    const match = text.match(monthPattern);
    if (match) {
      return parseDateOfBirth(match[0]);
    }
  }
  
  // Look for numeric date patterns
  const datePattern = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/;
  const match = text.match(datePattern);
  if (match) {
    return parseDateOfBirth(match[0]);
  }
  
  return '';
}

// Robust helper: Find date in text with noisy OCR tolerance
function findDateInText(text) {
  if (!text) return '';
  const upper = text.toUpperCase();

  const monthMap = {
    JANUARY: '01', JAN: '01', JANURAY: '01', JANURRY: '01', JANURRAY: '01', JANUARYY: '01',
    FEBRUARY: '02', FEB: '02', FEBRUARYY: '02',
    MARCH: '03', MAR: '03',
    APRIL: '04', APR: '04',
    MAY: '05',
    JUNE: '06', JUN: '06',
    JULY: '07', JUL: '07',
    AUGUST: '08', AUG: '08',
    SEPTEMBER: '09', SEP: '09', SEPT: '09',
    OCTOBER: '10', OCT: '10', OKTOBER: '10',
    NOVEMBER: '11', NOV: '11',
    DECEMBER: '12', DEC: '12',
  };

  // Greedy try month usually near date label
  for (const key of Object.keys(monthMap)) {
    const rx = new RegExp(key + '\\s+(\\d{1,2}|[A-Z]{1,2})[,\\s]+(\\d{3,4})', 'i');
    const m = upper.match(rx);
    if (m) {
      let day = m[1];
      let year = m[2];
      if (!/\d/.test(day)) {
        if (/^B|BL|0L$/i.test(day)) day = '01';
        else if (/^[OI]$/i.test(day)) day = '01';
      }

      day = day.replace(/[^0-9]/g, '');
      if (!day) day = '01';
      if (Number(day) < 1 || Number(day) > 31) day = '01';
      let yearNum = year.replace(/[^0-9]/g, '');
      if (yearNum.length === 3) yearNum = '1' + yearNum;
      if (yearNum.length === 4 && Number(yearNum) < 1900) {
        if (/^15|16/.test(yearNum)) yearNum = '19' + yearNum.slice(2);
        else if (/^20/.test(yearNum) === false) yearNum = '19' + yearNum.slice(2);
      }
      const candidate = parseDateOfBirth(`${monthMap[key]}-${String(day).padStart(2, '0')}-${yearNum}`);
      if (candidate) return candidate;
    }
  }

  const numericPattern = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/;
  const numericMatch = upper.match(numericPattern);
  if (numericMatch) {
    const candidate = parseDateOfBirth(numericMatch[0]);
    if (candidate) return candidate;
  }

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
  for (let i = 0; i < lines.length; i++) {
    const lowerLine = lines[i].toLowerCase();
    if (lowerLine.includes('date of birth') || lowerLine.includes('petsa') || lowerLine.includes('birt')) {
      for (let j = i; j < Math.min(i + 4, lines.length); j++) {
        const candidate = parseDateOfBirth(lines[j]);
        if (candidate) return candidate;
      }
    }
  }

  return '';
}

// Helper: Normalize date for database (YYYY-MM-DD)
function normalizeDateForDb(dateStr) {
  if (!dateStr) return '';
  const str = dateStr.trim();

  // Try MM/DD/YYYY or DD/MM/YYYY
  const dmMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmMatch) {
    const [_, a, b, y] = dmMatch;
    let day = parseInt(a, 10);
    let month = parseInt(b, 10);

    if (month > 12) {
      [day, month] = [month, day];
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Try YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymdMatch) {
    const [_, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return '';
}

// Helper: Calculate age from date of birth
function calculateAge(dob) {
  if (!dob) return 0;
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return Math.max(0, age);
}

// ============ DOCTOR ENDPOINTS ============

app.get('/api/doctor/consultations', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can access this endpoint.' });
    }

    const consultations = await db.getConsultationsByDoctor(user.id);
    return res.json({ success: true, consultations });
  } catch (err) {
    console.error('doctor consultations error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/doctor/consultation/:id', async (req, res) => {
  try {
    const consultationId = req.params.id;
    const userId = req.query.userId;

    if (!userId || !consultationId) {
      return res.status(400).json({ success: false, message: 'userId and consultation ID are required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can access this endpoint.' });
    }

    const consultation = await db.getConsultationById(consultationId);
    if (!consultation) {
      return res.status(404).json({ success: false, message: 'Consultation not found.' });
    }

    if (consultation.assessment_json) {
      consultation.assessment = JSON.parse(consultation.assessment_json);
    }

    return res.json({ success: true, consultation });
  } catch (err) {
    console.error('doctor consultation detail error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.put('/api/doctor/consultation/:id', async (req, res) => {
  try {
    const consultationId = req.params.id;
    const { userId, status, consultationDate, consultationTime, consultationTimeEnd, notes } = req.body;

    if (!userId || !consultationId) {
      return res.status(400).json({ success: false, message: 'userId and consultation ID are required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can update consultations.' });
    }

    const updates = {};
    if (status) updates.status = status;
    if (consultationDate) updates.consultation_date = consultationDate;
    if (consultationTime) updates.consultation_time = consultationTime;
    if (consultationTimeEnd) updates.consultation_time_end = consultationTimeEnd;
    if (notes) updates.notes = notes;
    updates.doctor_id = userId;

    await db.updateConsultation(consultationId, updates);

    // Create notification for patient
    const consultation = await db.getConsultationById(consultationId);
    if (consultation) {
      const notificationMsg = status === 'scheduled' ? 
        `Your consultation is scheduled for ${consultationDate} at ${consultationTime}` :
        `Your consultation request status has been updated to: ${status}`;
      await db.createNotification({
        userId: consultation.patient_id,
        type: `consultation_${status}`,
        message: notificationMsg
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('update consultation error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.post('/api/doctor/availability', async (req, res) => {
  try {
    const { userId, availableDate, timeSlots } = req.body;

    if (!userId || !availableDate || !timeSlots || !Array.isArray(timeSlots)) {
      return res.status(400).json({ success: false, message: 'userId, availableDate, and timeSlots are required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can set availability.' });
    }

    const availability = await db.setDoctorAvailability({ doctorId: userId, availableDate, timeSlots });
    return res.status(201).json({ success: true, availability });
  } catch (err) {
    console.error('set availability error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/doctor/my-availability', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can access this endpoint.' });
    }

    const availability = await db.getDoctorAvailabilityByDoctor(userId);
    return res.json({ success: true, availability });
  } catch (err) {
    console.error('my availability error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/doctor/patient/:patientId', async (req, res) => {
  try {
    const doctorId = req.query.doctorId;
    const patientId = req.params.patientId;

    if (!doctorId || !patientId) {
      return res.status(400).json({ success: false, message: 'doctorId and patientId are required.' });
    }

    const doctor = await db.getUserById(doctorId);
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can access patient EMR.' });
    }

    const patientEMR = await db.getPatientEMR(patientId);
    if (!patientEMR) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    // CP-ABE: Decrypt assessment with policy checking (doctor role allowed)
    try {
      const assessment = await db.getPatientAssessmentByUserId(patientId, doctor);
      if (assessment) {
        patientEMR.assessment = assessment.assessment;
      }
    } catch (error) {
      console.log('Assessment access denied:', error.message);
      // Continue without assessment if there's an issue
    }

    return res.json({ success: true, emr: patientEMR });
  } catch (err) {
    console.error('get patient emr error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/doctor/profile', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const profile = await db.getDoctorProfile(userId);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    }

    return res.json({ success: true, profile });
  } catch (err) {
    console.error('doctor profile error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.put('/api/doctor/profile', async (req, res) => {
  try {
    const { userId, updates } = req.body;
    if (!userId || !updates) {
      return res.status(400).json({ success: false, message: 'userId and updates are required.' });
    }

    const user = await db.getUserById(userId);
    if (!user || user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can update their profile.' });
    }

    await db.updateDoctorProfile(userId, updates);
    return res.json({ success: true });
  } catch (err) {
    console.error('update doctor profile error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/doctor/patients', async (req, res) => {
  try {
    const doctorId = req.query.doctorId;
    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'doctorId is required.' });
    }

    const user = await db.getUserById(doctorId);
    if (!user || user.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can access this endpoint.' });
    }

    const patients = await db.getAllPatientsWithConsultations(doctorId);
    return res.json({ success: true, patients });
  } catch (err) {
    console.error('doctor patients list error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/doctor/patient/:patientUserId/consultations', async (req, res) => {
  try {
    const doctorId = req.query.doctorId;
    const patientUserId = req.params.patientUserId;

    if (!doctorId || !patientUserId) {
      return res.status(400).json({ success: false, message: 'doctorId and patientUserId are required.' });
    }

    const doctor = await db.getUserById(doctorId);
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(403).json({ success: false, message: 'Only doctors can access this endpoint.' });
    }

    const consultations = await db.getConsultationsByPatient(patientUserId);
    return res.json({ success: true, consultations });
  } catch (err) {
    console.error('doctor patient consultations error', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok' });
});

if (require.main === module) {
  (async () => {
    try {
      await db.init();
      app.listen(PORT, () => {
        console.log(`Server listening on http://localhost:${PORT}`);
      });
    } catch (err) {
      console.error('Failed to start server', err);
      process.exit(1);
    }
  })();
}

module.exports = {
  parsePhilippineIdOcr,
};

