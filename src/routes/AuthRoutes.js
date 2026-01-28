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

    // Email configuration optimized for Render
    const createTransporter = () => {
        const emailUser = process.env.EMAIL_USER;
        const emailPass = process.env.EMAIL_PASS;
        
        if (!emailUser || !emailPass) {
            console.error('EMAIL CREDENTIALS MISSING: EMAIL_USER and EMAIL_PASS must be set in environment variables');
            return null;
        }

        try {
            // Render-compatible configuration
            const transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 587,
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

    const transporter = createTransporter();

    const sendOTPEmail = async (email, otp, type = 'login') => {
        // Check if email is configured
        if (!transporter || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            return { 
                success: false, 
                devMode: true,
                error: "Email service not configured. Set EMAIL_USER and EMAIL_PASS environment variables."
            };
        }

        const subject = type === 'login'
            ? 'Your Login OTP - BizTrack'
            : 'Password Reset OTP - BizTrack';

        try {
            const mailOptions = {
                from: {
                    name: 'BizTrack Application',
                    address: process.env.EMAIL_USER
                },
                to: email,
                subject: subject,
                // Simple HTML email
                html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { text-align: center; margin-bottom: 30px; }
                        .otp-box { background: #f8f9fa; padding: 25px; text-align: center; border-radius: 8px; margin: 20px 0; border: 2px solid #dee2e6; }
                        .otp-code { font-size: 36px; font-weight: bold; color: #4F46E5; letter-spacing: 8px; margin: 10px 0; }
                        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; text-align: center; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>BizTrack Application</h1>
                        </div>
                        
                        <p>Hello,</p>
                        <p>Use the following OTP to complete your ${type === 'login' ? 'login' : 'password reset'}:</p>
                        
                        <div class="otp-box">
                            <div class="otp-code">${otp}</div>
                            <p>This code will expire in 10 minutes</p>
                        </div>
                        
                        <p><strong>Security Notice:</strong> Never share this OTP with anyone.</p>
                        
                        <div class="footer">
                            <p>© ${new Date().getFullYear()} BizTrack Application</p>
                        </div>
                    </div>
                </body>
                </html>
                `,
                // Plain text fallback
                text: `Your BizTrack OTP is: ${otp}. This code expires in 10 minutes.`
            };

            // Send email with timeout
            const sendPromise = transporter.sendMail(mailOptions);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Email sending timeout after 15 seconds')), 15000);
            });

            const info = await Promise.race([sendPromise, timeoutPromise]);
            
            return { 
                success: true,
                messageId: info.messageId
            };

        } catch (error) {
            console.error('Email sending failed:', error.message);
            
            // Return dev mode if email fails
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

            // Save OTP to database
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

            // Send OTP email
            const emailResult = await sendOTPEmail(email, otp, 'login');

            const response = {
                success: true,
                requiresOTP: true,
                devMode: emailResult.devMode || false,
                message: emailResult.devMode
                    ? `OTP: ${otp} (Email service: ${emailResult.error || 'Not configured'})`
                    : "OTP sent to your email",
                otpMasked: otpResult.maskedOtp
            };

            // Include OTP in response for dev mode
            if (emailResult.devMode) {
                response.otp = otp;
            }

            res.json(response);

        } catch (error) {
            console.error('Login error:', error.message);
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

            // Check OTP status
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

            if (!otpStatus.canBeUsed) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid OTP status",
                    code: "INVALID_OTP_STATUS"
                });
            }

            // Verify OTP
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
                    message: "Invalid or expired OTP. Please request a new one"
                });
            }

            // Consume OTP
            await storage.consumeOTP(
                email,
                otp,
                {
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                    consumptionSource: "login_verification"
                }
            );

            // Get user
            const user = await storage.getUserByEmail(email);
            const businessId = user.associatedBusinessId || user.institutionId;
            const business = await storage.getBusiness(businessId);
            
            if (!business) {
                return res.status(404).json({
                    success: false,
                    message: "Business profile not found"
                });
            }

            // Create user object
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

            // Create JWT token
            const tokenPayload = {
                id: user.id,
                email: user.email,
                role: user.role,
                businessUUID: business.id,
                businessId: business.businessId
            };

            const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '24h' });

            // Update last login
            await storage.updateUserLastLogin(user.id);

            res.status(200).json({
                success: true,
                message: "Login successful",
                user: cleanUser,
                token: token
            });

        } catch (error) {
            console.error('OTP verification error:', error.message);
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
                // For security, don't reveal if user exists
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
            console.error('Resend OTP error:', error.message);
            res.status(500).json({
                success: false,
                message: "Unable to resend OTP"
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
                // For security, don't reveal if user exists
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
            console.error('Forgot password error:', error.message);
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
                resetToken: resetToken
            });

        } catch (error) {
            console.error('Reset OTP verification error:', error.message);
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
            console.error('Password reset error:', error.message);
            res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    });

    return router;
}