// src/routes/AuthRoutes.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";

export default function AuthRoutes(storage) {
    const router = express.Router();
    const otpStore = new Map();

    const generateOTP = () => {
        return Math.floor(100000 + Math.random() * 900000).toString();
    };

    const DEV_MODE = process.env.NODE_ENV !== 'production';

    console.log(`🔧 Email Configuration Status:`);
    console.log(`   - NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
    console.log(`   - EMAIL_USER: ${process.env.EMAIL_USER ? 'Set (' + process.env.EMAIL_USER + ')' : 'Not set'}`);
    console.log(`   - EMAIL_PASS: ${process.env.EMAIL_PASS ? 'Set (length: ' + process.env.EMAIL_PASS.length + ')' : 'Not set'}`);
    console.log(`   - JWT_SECRET: ${process.env.JWT_SECRET ? 'Set' : 'Not set - USING FALLBACK - UNSECURE!'}`);

    let transporter;

    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        console.log('🔄 Attempting to create email transporter...');
        try {
            transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                },
                connectionTimeout: 10000,
                socketTimeout: 10000,
                debug: true,
                logger: true
            });

            console.log('✅ Email transporter created, verifying connection...');

            transporter.verify(function (error, success) {
                if (error) {
                    console.log('❌ Email transporter verification FAILED:', error.message);
                    console.log('🔧 Error details:', error);
                } else {
                    console.log('✅ Email transporter is ready to send messages');
                }
            });
        } catch (error) {
            console.error('❌ Failed to create email transporter:', error.message);
            console.error('🔧 Stack trace:', error.stack);
        }
    } else {
        console.log('🔧 No email credentials found - emails will be logged to console only');
    }

    const sendOTPEmail = async (email, otp, type = 'login') => {
        console.log(`\n📧 === ATTEMPTING TO SEND ${type.toUpperCase()} OTP ===`);
        console.log(`   To: ${email}`);
        console.log(`   OTP: ${otp}`);
        console.log(`   Transporter available: ${!!transporter}`);

        if (!transporter) {
            console.log(`📧 [NO TRANSPORTER] OTP for ${email}: ${otp}`);
            console.log(`⏰ OTP expires in 10 minutes`);
            console.log(`💡 Reason: Email transporter not available - check credentials`);
            return Promise.resolve({ success: true, mode: 'console' });
        }

        const subject = type === 'login' ? 'Your Login OTP - BizTrack' : 'Password Reset OTP - BizTrack';

        try {
            console.log('🔄 Preparing email...');

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
                    <p style="font-size: 16px;">Use the following OTP to complete your login:</p>
                    <div style="background: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
                        <h1 style="margin: 0; color: #333; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
                    </div>
                    <p style="font-size: 14px; color: #666;">
                        This OTP will expire in 10 minutes. Do not share it with anyone.
                    </p>
                </div>
            `
            };

            console.log('🔄 Sending email...');
            const result = await transporter.sendMail(mailOptions);

            console.log(`✅ ${type.toUpperCase()} OTP email sent successfully to ${email}`);
            console.log(`   Message ID: ${result.messageId}`);
            console.log(`   Response: ${result.response}`);
            return { success: true, messageId: result.messageId };

        } catch (error) {
            console.error(`❌ ERROR sending ${type} email:`, error.message);
            console.error(`🔧 Error details:`, error);
            console.log(`📧 [EMAIL FAILED] OTP for ${email}: ${otp}`);
            console.log(`⏰ OTP expires in 10 minutes - USE THIS CODE TO LOGIN`);
            return { success: false, error: error.message };
        }
    };

    // POST /api/auth/login - Initiate login with email/password
    router.post("/login", async (req, res) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({
                    success: false,
                    message: "Email and password are required"
                });
            }

            const user = await storage.getUserByEmail(email);
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid email or password"
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
            const otpExpiry = Date.now() + 10 * 60 * 1000;

            otpStore.set(email, {
                otp,
                expiry: otpExpiry,
                userId: user.id,
                userData: user
            });

            await sendOTPEmail(email, otp, 'login');

            console.log(`🎯 Login OTP for ${email}: ${otp}`);
            console.log(`⏰ OTP expires at: ${new Date(otpExpiry).toLocaleString()}`);

            res.json({
                success: true,
                message: "OTP sent to your email",
                email: email,
                requiresOTP: true,
                debug_otp: DEV_MODE ? otp : undefined
            });

        } catch (error) {
            console.error("Login error:", error);
            res.status(500).json({
                success: false,
                message: "Internal server error",
                error: error.message
            });
        }
    });

    // POST /api/auth/resend-otp - Resend OTP for login
    router.post("/resend-otp", async (req, res) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: "Email is required"
                });
            }

            const storedData = otpStore.get(email);
            if (!storedData) {
                return res.status(400).json({
                    success: false,
                    message: "No active OTP session found. Please login again."
                });
            }

            const otp = generateOTP();
            const otpExpiry = Date.now() + 10 * 60 * 1000;

            otpStore.set(email, {
                otp,
                expiry: otpExpiry,
                userId: storedData.userId,
                userData: storedData.userData
            });

            await sendOTPEmail(email, otp, 'login');

            console.log(`🔄 Resent Login OTP for ${email}: ${otp}`);
            console.log(`⏰ New OTP expires at: ${new Date(otpExpiry).toLocaleString()}`);

            res.json({
                success: true,
                message: "New OTP sent to your email",
                debug_otp: DEV_MODE ? otp : undefined
            });

        } catch (error) {
            console.error("Resend OTP error:", error);
            res.status(500).json({
                success: false,
                message: "Failed to resend OTP",
                error: error.message
            });
        }
    });

    // POST /api/auth/verify-otp - Verify OTP for login (UPDATED WITH JWT)
    router.post("/verify-otp", async (req, res) => {
        try {
            const { email, otp } = req.body;

            if (!email || !otp) {
                return res.status(400).json({
                    success: false,
                    message: "Email and OTP are required"
                });
            }

            const storedData = otpStore.get(email);

            if (!storedData) {
                return res.status(400).json({
                    success: false,
                    message: "OTP not found or expired. Please request a new OTP."
                });
            }

            if (Date.now() > storedData.expiry) {
                otpStore.delete(email);
                return res.status(400).json({
                    success: false,
                    message: "OTP has expired. Please request a new OTP."
                });
            }

            if (storedData.otp !== otp) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid OTP. Please check and try again."
                });
            }

            const user = storedData.userData;

            let userWithoutPassword;
            if (user && typeof user.toObject === 'function') {
                userWithoutPassword = user.toObject();
            } else {
                userWithoutPassword = { ...user };
            }

            delete userWithoutPassword.password;
            const cleanUser = JSON.parse(JSON.stringify(userWithoutPassword));

            // JWT TOKEN GENERATION
            const token = jwt.sign(
                {
                    userId: user.id,
                    email: user.email,
                    role: user.role,
                    businessName: user.businessName,
                    permissions: user.permissions
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            otpStore.delete(email);

            console.log(`✅ User ${email} logged in successfully`);
            console.log(`🔐 JWT Token generated for role: ${user.role}`);
            console.log(`⏰ Token expires in: 24 hours`);

            res.json({
                success: true,
                message: "Login successful",
                user: cleanUser,
                token: token,
                redirectTo: getDashboardRoute(user.role)
            });

        } catch (error) {
            console.error("OTP verification error:", error);
            res.status(500).json({
                success: false,
                message: "Internal server error",
                error: error.message
            });
        }
    });

    // POST /api/auth/forgot-password - Initiate password reset
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

            const otp = generateOTP();
            const otpExpiry = Date.now() + 10 * 60 * 1000;

            otpStore.set(`reset_${email}`, {
                otp,
                expiry: otpExpiry,
                userId: user.id,
                email: email
            });

            await sendOTPEmail(email, otp, 'reset');

            console.log(`🎯 Password Reset OTP for ${email}: ${otp}`);
            console.log(`⏰ Reset OTP expires at: ${new Date(otpExpiry).toLocaleString()}`);

            res.json({
                success: true,
                message: "Reset OTP sent to your email",
                email: email,
                requiresOTP: true,
                debug_otp: DEV_MODE ? otp : undefined
            });

        } catch (error) {
            console.error("Forgot password error:", error);
            res.status(500).json({
                success: false,
                message: "Internal server error",
                error: error.message
            });
        }
    });

    // POST /api/auth/resend-reset-otp - Resend OTP for password reset
    router.post("/resend-reset-otp", async (req, res) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: "Email is required"
                });
            }

            const storedData = otpStore.get(`reset_${email}`);
            if (!storedData) {
                return res.status(400).json({
                    success: false,
                    message: "No active reset session found. Please start password reset again."
                });
            }

            const otp = generateOTP();
            const otpExpiry = Date.now() + 10 * 60 * 1000;

            otpStore.set(`reset_${email}`, {
                otp,
                expiry: otpExpiry,
                userId: storedData.userId,
                email: email
            });

            await sendOTPEmail(email, otp, 'reset');

            console.log(`🔄 Resent Reset OTP for ${email}: ${otp}`);
            console.log(`⏰ New Reset OTP expires at: ${new Date(otpExpiry).toLocaleString()}`);

            res.json({
                success: true,
                message: "New reset OTP sent to your email",
                debug_otp: DEV_MODE ? otp : undefined
            });

        } catch (error) {
            console.error("Resend reset OTP error:", error);
            res.status(500).json({
                success: false,
                message: "Failed to resend reset OTP",
                error: error.message
            });
        }
    });

    // POST /api/auth/verify-reset-otp - Verify OTP for password reset
    router.post("/verify-reset-otp", async (req, res) => {
        try {
            const { email, otp } = req.body;

            if (!email || !otp) {
                return res.status(400).json({
                    success: false,
                    message: "Email and OTP are required"
                });
            }

            const storedData = otpStore.get(`reset_${email}`);

            if (!storedData) {
                return res.status(400).json({
                    success: false,
                    message: "OTP not found or expired. Please request a new OTP."
                });
            }

            if (Date.now() > storedData.expiry) {
                otpStore.delete(`reset_${email}`);
                return res.status(400).json({
                    success: false,
                    message: "OTP has expired. Please request a new OTP."
                });
            }

            if (storedData.otp !== otp) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid OTP. Please check and try again."
                });
            }

            // Generate JWT token for password reset
            const resetToken = jwt.sign(
                {
                    userId: storedData.userId,
                    email: email,
                    type: 'password_reset'
                },
                process.env.JWT_SECRET,
                { expiresIn: '10m' } // Short expiry for reset tokens
            );

            otpStore.delete(`reset_${email}`);

            console.log(`✅ Password reset OTP verified for: ${email}`);

            res.json({
                success: true,
                message: "OTP verified successfully",
                resetToken: resetToken
            });

        } catch (error) {
            console.error("Reset OTP verification error:", error);
            res.status(500).json({
                success: false,
                message: "Internal server error",
                error: error.message
            });
        }
    });

    // POST /api/auth/reset-password - Reset password with JWT token
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

            if (newPassword.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: "Password must be at least 6 characters long"
                });
            }

            // Verify JWT reset token
            let decoded;
            try {
                decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid or expired reset token"
                });
            }

            if (decoded.type !== 'password_reset') {
                return res.status(400).json({
                    success: false,
                    message: "Invalid reset token"
                });
            }

            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

            await storage.updateUserPassword(decoded.userId, hashedPassword);

            console.log(`✅ Password reset successfully for user: ${decoded.email}`);

            res.json({
                success: true,
                message: "Password reset successfully"
            });

        } catch (error) {
            console.error("Password reset error:", error);
            res.status(500).json({
                success: false,
                message: "Internal server error",
                error: error.message
            });
        }
    });

    const getDashboardRoute = (role) => {
        const routes = {
            'Super_Admin': '/dashboard/super-admin',
            'Biztrack_ADMIN': '/dashboard/super-admin',
            'Hotel_Admin': '/dashboard/hotel-admin',
            'Kiosk_Admin': '/dashboard/kiosk-admin',
            'Hospital_Admin': '/dashboard/hospital-admin',
            'user': '/dashboard/user'
        };
        return routes[role] || '/dashboard';
    };

    return router;
}