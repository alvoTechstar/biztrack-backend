// src/routes/AuthRoutes.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";

export default function AuthRoutes(storage) {
    const router = express.Router();

    const generateOTP = () => {
        return Math.floor(100000 + Math.random() * 900000).toString();
    };

    // Email configuration
    const createTransporter = () => {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            return null;
        }

        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                },
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                requireTLS: true,
                connectionTimeout: 30000,
                socketTimeout: 30000,
                greetingTimeout: 30000,
                tls: {
                    rejectUnauthorized: false
                },
                pool: true,
                maxConnections: 3,
                maxMessages: 50,
                rateLimit: 5
            });

            return transporter;
        } catch (error) {
            return null;
        }
    };

    const transporter = createTransporter();

    const sendOTPEmail = async (email, otp, type = 'login') => {
        if (!transporter || !process.env.EMAIL_USER) {
            return { success: true, devMode: true };
        }

        const subject = type === 'login'
            ? 'Your Login OTP - BizTrack'
            : 'Password Reset OTP - BizTrack';

        try {
            const mailOptions = {
                from: {
                    name: 'BizTrack',
                    address: process.env.EMAIL_USER
                },
                to: email,
                subject: subject,
                html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Your One-Time Password (OTP)</h2>
                    <p style="font-size: 16px;">Use the following OTP to complete your ${type === 'login' ? 'login' : 'password reset'}:</p>
                    <div style="background: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
                        <h1 style="margin: 0; color: #333; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
                    </div>
                    <p style="font-size: 14px; color: #666;">
                        This OTP will expire in 10 minutes. Do not share it with anyone.
                    </p>
                </div>
                `,
                headers: {
                    'X-Priority': '1',
                    'X-MSMail-Priority': 'High',
                    'Importance': 'high'
                }
            };

            const sendPromise = transporter.sendMail(mailOptions);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Email sending timeout')), 10000);
            });

            await Promise.race([sendPromise, timeoutPromise]);

            return { success: true };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                devMode: true
            };
        }
    };

    // ==================== LOGIN ENDPOINT ====================
    router.post("/login", async (req, res) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({
                    success: false,
                    message: "Email and password are required"
                });
            }

            const user = await storage.getUserByEmail(email.trim().toLowerCase());
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid email or password"
                });
            }

            if (user.status !== 'ACTIVE') {
                return res.status(403).json({
                    success: false,
                    message: "Your account is not active. Please contact administrator."
                });
            }

            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid email or password"
                });
            }

            const otp = generateOTP();

            const otpResult = await storage.createOTP(
                email,
                otp,
                'login',
                user.id,
                {
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent']
                }
            );

            const emailResult = await sendOTPEmail(email, otp, 'login');

            const response = {
                success: true,
                message: emailResult.devMode
                    ? `OTP: ${otp} (Email service not configured)`
                    : "OTP sent to your email",
                requiresOTP: true,
                devMode: emailResult.devMode || false,
                otpMasked: otpResult.maskedOtp
            };

            if (emailResult.devMode) {
                response.otp = otp;
            }

            res.json(response);

        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Internal server error during login"
            });
        }
    });

    // ==================== VERIFY OTP ENDPOINT ====================
    router.post("/verify-otp", async (req, res) => {
        try {
            const { email, otp } = req.body;

            if (!email || !otp) {
                return res.status(400).json({
                    success: false,
                    message: "Email and OTP are required"
                });
            }

            const otpStatus = await storage.getOTPStatus(email, otp);

            if (!otpStatus.exists) {
                return res.status(400).json({
                    success: false,
                    message: "No OTP found for this email"
                });
            }

            if (otpStatus.status === "consumed") {
                return res.status(400).json({
                    success: false,
                    message: "This OTP has already been used",
                    code: "OTP_ALREADY_CONSUMED"
                });
            }

            if (otpStatus.status === "expired") {
                return res.status(400).json({
                    success: false,
                    message: "OTP has expired. Please request a new one",
                    code: "OTP_EXPIRED"
                });
            }

            if (otpStatus.status === "revoked") {
                return res.status(400).json({
                    success: false,
                    message: "This OTP has been revoked. Please request a new one",
                    code: "OTP_REVOKED"
                });
            }

            if (!otpStatus.canBeUsed) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid OTP status",
                    code: "INVALID_OTP_STATUS"
                });
            }

            const storedOTP = await storage.getValidOTP(
                email,
                otp,
                'login',
                {
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent']
                }
            );
            
            if (!storedOTP) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid or expired OTP. Please request a new one",
                    code: "INVALID_OTP"
                });
            }

            await storage.consumeOTP(
                email,
                otp,
                {
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                    consumptionSource: "login_verification"
                }
            );

            const user = await storage.getUserByEmail(email);
            const businessId = user.associatedBusinessId || user.institutionId;
            const business = await storage.getBusiness(businessId);
            
            if (!business) {
                return res.status(404).json({
                    success: false,
                    message: "Business profile not found"
                });
            }

            const cleanUser = {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                status: user.status,
                permissions: user.permissions || [],
                lastLogin: new Date().toISOString(),
                businessId: business.businessId,
                businessUUID: business.id,
                businessName: business.businessName,
                businessType: business.businessType,
                primaryColor: business.primaryColor,
                logo: business.logoUrl
            };

            const tokenPayload = {
                id: user.id,
                email: user.email,
                role: user.role,
                businessUUID: business.id,
                businessId: business.businessId
            };

            const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '24h' });

            await storage.updateUserLastLogin(user.id);

            res.status(200).json({
                success: true,
                message: "Login successful",
                user: cleanUser,
                token: token,
                otpStatus: "consumed"
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Internal server error during OTP verification"
            });
        }
    });

    // ==================== RESEND OTP ENDPOINT ====================
    router.post("/resend-otp", async (req, res) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: "Email is required"
                });
            }

            const user = await storage.getUserByEmail(email);
            if (!user) {
                return res.json({
                    success: true,
                    message: "If the email exists, a new OTP has been sent"
                });
            }

            const otp = generateOTP();

            const otpResult = await storage.createOTP(
                email,
                otp,
                'login',
                user.id,
                {
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                    resend: true
                }
            );

            const emailResult = await sendOTPEmail(email, otp, 'login');

            const response = {
                success: true,
                message: emailResult.devMode
                    ? `New OTP: ${otp} (Email service: ${emailResult.error || 'Not configured'})`
                    : "New OTP sent to your email",
                devMode: emailResult.devMode || false,
                otpMasked: otpResult.maskedOtp
            };

            if (emailResult.devMode) {
                response.otp = otp;
            }

            res.json(response);

        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Unable to resend OTP"
            });
        }
    });

    // ==================== CHECK OTP STATUS ENDPOINT ====================
    router.post("/check-otp-status", async (req, res) => {
        try {
            const { email, otp } = req.body;
            
            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: "Email is required"
                });
            }
            
            const otpStatus = await storage.getOTPStatus(email, otp);
            
            res.json({
                success: true,
                data: otpStatus
            });
            
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Error checking OTP status"
            });
        }
    });

    // ==================== FORGOT PASSWORD ENDPOINT ====================
    router.post("/forgot-password", async (req, res) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: "Email is required"
                });
            }

            const user = await storage.getUserByEmail(email);
            if (!user) {
                return res.json({
                    success: true,
                    message: "If the email exists, a reset OTP has been sent"
                });
            }

            const recentAttempts = await storage.getRecentOTPAttempts(email, 10);
            if (recentAttempts >= 3) {
                return res.status(429).json({
                    success: false,
                    message: "Too many reset attempts. Please wait 10 minutes."
                });
            }

            const otp = generateOTP();
            const otpResult = await storage.createOTP(
                email,
                otp,
                'reset',
                user.id,
                {
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent']
                }
            );

            const emailResult = await sendOTPEmail(email, otp, 'reset');

            res.json({
                success: true,
                message: emailResult.devMode
                    ? `Reset OTP: ${otp} (Email service not configured)`
                    : "Reset OTP sent to your email",
                devMode: emailResult.devMode || false,
                otpMasked: otpResult.maskedOtp
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Unable to process password reset"
            });
        }
    });

    // ==================== VERIFY RESET OTP ENDPOINT ====================
    router.post("/verify-reset-otp", async (req, res) => {
        try {
            const { email, otp } = req.body;

            if (!email || !otp) {
                return res.status(400).json({
                    success: false,
                    message: "Email and OTP are required"
                });
            }

            const otpStatus = await storage.getOTPStatus(email, otp);
            
            if (!otpStatus.exists) {
                return res.status(400).json({
                    success: false,
                    message: "No OTP found for this email"
                });
            }

            if (otpStatus.status === "consumed") {
                return res.status(400).json({
                    success: false,
                    message: "This OTP has already been used",
                    code: "OTP_ALREADY_CONSUMED"
                });
            }

            if (otpStatus.status === "expired") {
                return res.status(400).json({
                    success: false,
                    message: "OTP has expired. Please request a new one",
                    code: "OTP_EXPIRED"
                });
            }

            const storedOTP = await storage.getValidOTP(email, otp, 'reset', {
                ipAddress: req.ip,
                userAgent: req.headers['user-agent']
            });
            
            if (!storedOTP) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid or expired OTP. Please request a new one."
                });
            }

            await storage.consumeOTP(email, otp, {
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                consumptionSource: "password_reset"
            });

            const resetToken = jwt.sign(
                {
                    id: storedOTP.userId,
                    email: email,
                    type: 'password_reset'
                },
                process.env.JWT_SECRET,
                { expiresIn: '10m' }
            );

            res.json({
                success: true,
                message: "OTP verified successfully",
                resetToken: resetToken,
                otpStatus: "consumed"
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    });

    // ==================== RESET PASSWORD ENDPOINT ====================
    router.post("/reset-password", async (req, res) => {
        try {
            const { resetToken, newPassword, confirmPassword } = req.body;

            if (!resetToken || !newPassword || !confirmPassword) {
                return res.status(400).json({
                    success: false,
                    message: "All fields are required"
                });
            }

            if (newPassword !== confirmPassword) {
                return res.status(400).json({
                    success: false,
                    message: "Passwords do not match"
                });
            }

            let decoded;
            try {
                decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid or expired password reset token."
                });
            }

            if (decoded.type !== 'password_reset') {
                return res.status(400).json({
                    success: false,
                    message: "Invalid reset token"
                });
            }

            const user = await storage.getUserByEmail(decoded.email);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            if (user.password) {
                const isSameAsOldPassword = await bcrypt.compare(newPassword, user.password);
                if (isSameAsOldPassword) {
                    return res.status(400).json({
                        success: false,
                        message: "New password cannot be the same as the old password."
                    });
                }
            }

            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

            const updateResult = await storage.updateUserPassword(user.id, hashedPassword);
            if (!updateResult) {
                return res.status(400).json({
                    success: false,
                    message: "Failed to update password"
                });
            }

            res.json({
                success: true,
                message: "Password has been reset successfully."
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    });

    // ==================== DEBUG ENDPOINTS (REMOVE IN PRODUCTION) ====================
    router.get("/debug/otps", async (req, res) => {
        try {
            const { email } = req.query;
            
            await storage.debugOTPs(email);
            
            const totalOTPs = await storage.OTP.countDocuments();
            const activeOTPs = await storage.OTP.countDocuments({ 
                status: "pending", 
                expiresAt: { $gt: new Date() } 
            });
            
            res.json({
                success: true,
                message: "OTP debug information logged to console",
                stats: {
                    totalOTPs,
                    activeOTPs,
                    emailFilter: email || 'all emails',
                    timestamp: new Date().toISOString()
                }
            });
            
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Debug failed",
                error: error.message
            });
        }
    });

    router.post("/test/otp", async (req, res) => {
        try {
            const { email } = req.body;
            
            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: "Email is required"
                });
            }
            
            const otp = generateOTP();
            
            const otpResult = await storage.createOTP(email, otp, 'test');
            
            await storage.debugOTPs(email);
            
            res.json({
                success: true,
                message: "Test OTP created",
                otpId: otpResult.id,
                otp: otpResult.otp,
                otpMasked: otpResult.maskedOtp
            });
            
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Test failed",
                error: error.message
            });
        }
    });

    router.post("/test/email", async (req, res) => {
        try {
            const { email } = req.body;
            
            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: "Email is required"
                });
            }
            
            const testResult = await sendOTPEmail(email, "999999", "test");
            
            res.json({
                success: testResult.success,
                message: testResult.success ? "Test email sent" : "Failed to send test email",
                devMode: testResult.devMode,
                error: testResult.error,
                details: {
                    emailConfigured: !!(process.env.EMAIL_USER && process.env.EMAIL_PASS),
                    transporterAvailable: !!transporter,
                    testOTP: "999999"
                }
            });
            
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "Test failed",
                error: error.message
            });
        }
    });

    return router;
}