const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer'); // Importar nodemailer
const app = express();
const port = 10000;

// Configurar que Express confíe en el proxy (útil en producción)
app.set('trust proxy', true);

// Configurar Multer para guardar archivos temporalmente en disco
const upload = multer({
  dest: 'uploads/', // Carpeta temporal donde se guardan los archivos
  limits: { fileSize: 8 * 1024 * 1024 * 1024 } // Límite de 8GB (ajustable)
});

app.use(express.json({ limit: '10gb' })); 
app.use(express.urlencoded({ limit: '10gb', extended: true }));

// Configurar credenciales de Google Drive
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const auth = new google.auth.GoogleAuth({
  credentials: credentials,
  scopes: ['https://www.googleapis.com/auth/drive']
});
const drive = google.drive({ version: 'v3', auth });

let tempFiles = {}; // Variable para llevar el control de los archivos temporales

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,  // Tu correo de Gmail
    pass: process.env.EMAIL_PASS   // Contraseña de aplicación de Google
  }
});

// Ruta para enviar un email después de la subida
app.post('/send-email', async (req, res) => {
  const { email, fileLink } = req.body;

  if (!email || !fileLink) {
    return res.status(400).json({ error: "Faltan parámetros" });
  }

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: '📎 Archivo compartido contigo',
    text: `¡Hola! Un archivo ha sido subido y puedes descargarlo aquí: ${fileLink}\n\nEste enlace expirará pronto.`
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Correo enviado a ${email}`);
    res.json({ message: "Correo enviado con éxito" });
  } catch (error) {
    console.error("❌ Error enviando el correo:", error);
    res.status(500).json({ error: "No se pudo enviar el correo." });
  }
});


const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,  // Usa las variables de entorno
  process.env.GOOGLE_CLIENT_SECRET,
  "http://quickexpire.onrender.com/auth/google/callback"  // Cambia a tu dominio en producción
);

// Ruta para obtener el enlace de autenticación con Google
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file']
  });
  res.json({ url: authUrl });
});

// Ruta de redirección después de autenticación
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  res.json(tokens); // Envía los tokens al frontend
});



// Ruta para eliminar archivos expirados
setInterval(async () => {
  const now = Date.now();
  for (const fileId in tempFiles) {
    if (tempFiles[fileId] < now) {
      try {
        await drive.files.delete({ fileId: fileId });
        console.log(`Archivo ${fileId} eliminado por expiración.`);
        delete tempFiles[fileId];
      } catch (error) {
        console.error(`Error al eliminar archivo ${fileId}:`, error);
      }
    }
  }
}, 60000);

// Ruta para descargar archivo desde Google Drive
app.get('/download', async (req, res) => {
  const fileId = req.query.file;
  if (!fileId) {
    return res.redirect('/error_expirado.html');
  }

  try {
    if (!tempFiles[fileId] || tempFiles[fileId] < Date.now()) {
      return res.redirect('/error_expirado.html');
    }

    const metaResponse = await drive.files.get({
      fileId: fileId,
      fields: 'name, mimeType'
    });
    const fileName = metaResponse.data.name || 'downloaded_file';
    const mimeType = metaResponse.data.mimeType;

    const driveResponse = await drive.files.get({
      fileId: fileId,
      alt: 'media'
    }, { responseType: 'stream' });

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', mimeType);

    driveResponse.data.on('end', () => {
      console.log('Descarga completada.');
    }).on('error', err => {
      console.error('Error al descargar archivo:', err);
      res.redirect('/error_expirado.html');
    });

    driveResponse.data.pipe(res);
  } catch (error) {
    console.error("Error al descargar archivo:", error);
    res.redirect('/error_expirado.html');
  }
});

// Servir archivos estáticos
app.use(express.static('public'));

app.use((req, res, next) => {
  req.setTimeout(0); // Deshabilita timeout en solicitudes largas
  res.setTimeout(0);
  next();
});



app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});

