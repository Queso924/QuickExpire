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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configurar credenciales de Google Drive
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const auth = new google.auth.GoogleAuth({
  credentials: credentials,
  scopes: ['https://www.googleapis.com/auth/drive']
});
const drive = google.drive({ version: 'v3', auth });

let tempFiles = {}; // Variable para llevar el control de los archivos temporales

// Configurar transporte de correo
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // CAMBIA ESTO POR TU CORREO
    pass: process.env.EMAIL_PASS // CAMBIA ESTO POR TU CONTRASEÑA O USA VARIABLES DE ENTORNO
  }
});

// Ruta para subir archivo
app.post('/upload', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se ha subido ningún archivo." });
    }

    const expirationTime = Date.now() + parseInt(req.body.time) * 60000;
    const filePath = req.file.path;
    const email = req.body.email ? req.body.email.trim() : ""; // Asegurar que no sea undefined

    const fileMetadata = {
      name: req.file.originalname,
      parents: ['16U4IvbnFx_Yon59VgbM-Hm8PzjM9kPc6']
    };

    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(filePath)
    };

    const driveResponse = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
      uploadType: 'resumable'
    });

    const fileId = driveResponse.data.id;
    tempFiles[fileId] = expirationTime;
    console.log(`Archivo subido con ID: ${fileId}, expira en: ${req.body.time} minutos`);

    // Eliminar el archivo temporal del servidor
    fs.unlink(filePath, (err) => {
      if (err) console.error(`Error eliminando archivo temporal: ${err}`);
    });

    // 📩 Enviar correo solo si el usuario proporcionó un email
    if (email !== "") {
      // Obtener protocolo y host para generar el enlace dinámicamente
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers.host;
      const downloadLink = `${protocol}://${host}/download?file=${fileId}`;

      const mailOptions = {
        from: 'quickexpire@gmail.com', // Debe ser el mismo correo de autenticación
        to: email,
        subject: '¡Han compartido un archivo temporal contigo!',
        text: `¡Hola! Acaban de compartir un archivo contigo. Puedes descargarlo en el siguiente enlace: ${downloadLink}\n\nEste enlace expirará en ${req.body.time} minutos.`
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error('❌ Error enviando el correo:', error);
        } else {
          console.log('✅ Correo enviado: ' + info.response);
        }
      });
    } else {
      console.log("⚠️ No se proporcionó un correo, no se enviará email.");
    }

    res.json({ fileId });
  } catch (error) {
    console.error("❌ Error al subir archivo:", error);
    res.status(500).json({ error: "Error al subir archivo." });
  }
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

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
