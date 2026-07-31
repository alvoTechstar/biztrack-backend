require('dotenv').config();
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// const transported = nodemailer.createTransport({
//     host: process.env.SMTP_HOST,
//     port: Number(process.env.SMTP_PORT),
//     secure: false,
//     auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.SMTP_PASS,
//     }
// });

// export async function sendMagicLink(to, bizCode) {
//     const magicLink = `https://yourapp.com/magic-link?code=${bizCode}`;
    
//     await transported.sendMail({
//         from: `"BizTrack" <${process.env.EMAIL_USER}>`,
//         to,
//         subject: "Set up your BizTrack Account",
//         html: `
//             <h2>Welcome to BizTrack!</h2>
//             <p>Click the link below to set your password:</p>
//             <a href="${magicLink}">${magicLink}</a>
//             <p>This link will expire in 24 hours.</p>
//         `
//     });
// }

// export function generateOTP() {
//     return crypto.randomInt(100000, 999999).toString();
// }

// export async function sendOTPEmail(to, otp) {
//     await transported.sendMail({
//         from: `"BizTrack" <${process.env.EMAIL_USER}>`,
//         to,
//         subject: "Your BizTrack Verification OTP",
//         html: `
//             <h2>Your OTP Code</h2>
//             <p>Please use this code to verify your account:</p>
//             <h1 style="letter-spacing: 4px;">${otp}</h1>
//             <p>This OTP expires in 10 minutes.</p>
//         `
//     });
// }

const createTransporter = () => {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.SMTP_PASS;

    if (!emailUser || !emailPass) {
        console.error('EMAIL CREDENTIALS MISSING: EMAIL_USER and SMTP_PASS must be set in environment variables');
        return null;
    }

    try {
        // Render-compatible configuration
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT),
            secure: false, // Use STARTTLS
            auth: {
                user: emailUser,
                pass: emailPass
            },
            // Important for Render
            connectionTimeout: 15000,
            socketTimeout: 15000,
            greetingTimeout: 10000,
            // TLS settings
            tls: {
                ciphers: 'SSLv3',
                rejectUnauthorized: false
            },
            // Pooling for better performance
            pool: true,
            maxConnections: 1,
            maxMessages: 10
        });

        return transporter;
    } catch (error) {
        console.error('Failed to create email transporter:', error.message);
        return null;
    }
};

module.exports = {
    createTransporter
};