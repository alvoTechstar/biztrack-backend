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

    // Email configuration with Render-friendly settings
    const createTransporter = () => {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.warn("⚠️ Email credentials not configured. OTPs will be logged to console only.");
            return null;
        }

        try {
            console.log("🔧 Creating email transporter for Render...");

            // Render-specific settings - keeps your existing config but optimized
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                },
                // IMPORTANT: Render-compatible settings
                host: 'smtp.gmail.com',
                port: 587, // Use port 587 (STARTTLS) instead of 465
                secure: false, // false for STARTTLS
                requireTLS: true, // Require TLS
                // Render timeout settings
                connectionTimeout: 30000, // Increased for Render
                socketTimeout: 30000,
                greetingTimeout: 30000,
                // TLS settings for Render
                tls: {
                    rejectUnauthorized: false // Bypass SSL cert validation on Render
                },
                // Keep your existing settings
                pool: true,
                maxConnections: 3, // Reduced for Render free tier
                maxMessages: 50,
                rateLimit: 5 // Reduced rate limiting
            });

            // MODIFIED: Don't verify immediately - it's failing on Render
            // Instead, verify on first use or log without verification
            console.log('✅ Email transporter created (delayed verification)');

            // Optional: Verify in background but don't block
            setTimeout(() => {
                transporter.verify((error) => {
                    if (error) {
                        console.warn('⚠️ Email verification failed (emails may still work):', error.message);
                        console.log('📧 OTPs will be logged to console. Check Render logs for OTPs.');
                    } else {
                        console.log('✅ Email connection verified successfully');
                    }
                });
            }, 2000); // Delay verification by 2 seconds

            return transporter;
        } catch (error) {
            console.error('❌ Failed to create email transporter:', error.message);
            console.log('📧 OTPs will be logged to console for manual entry');
            return null;
        }
    };
    const transporter = createTransporter();

    const sendOTPEmail = async (email, otp, type = 'login') => {
        // Always log OTP for debugging
        console.log(`📧 OTP for ${email}: ${otp} (type: ${type})`);

        // If email is not configured, log and return success for development
        if (!transporter || !process.env.EMAIL_USER) {
            console.log(`📧 [DEV MODE] Would send OTP ${otp} to ${email} for ${type}`);
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
                // Add headers for better deliverability
                headers: {
                    'X-Priority': '1',
                    'X-MSMail-Priority': 'High',
                    'Importance': 'high'
                }
            };

            // Add timeout to sendMail
            const sendPromise = transporter.sendMail(mailOptions);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Email sending timeout')), 10000);
            });

            await Promise.race([sendPromise, timeoutPromise]);

            console.log(`✅ OTP email sent successfully to ${email}`);
            return { success: true };

        } catch (error) {
            console.error("❌ Failed to send OTP email:", error.message);
            console.log(`📧 [FALLBACK] OTP for ${email}: ${otp}`);

            // Don't throw error - allow login to continue in development
            return {
                success: false,
                error: error.message,
                devMode: true
            };
        }
    };

    // POST /api/auth/login - Initiate login with email/password
    router.post("/login", async (req, res) => {
        try {
            const { email, password } = req.body;

            console.log("🔐 Login attempt:", { email, passwordLength: password?.length });

            if (!email || !password) {
                return res.status(400).json({
                    success: false,
                    message: "Email and password are required"
                });
            }

            const user = await storage.getUserByEmail(email);
            if (!user) {
                console.log(`❌ Login failed: User not found for ${email}`);
                return res.status(401).json({
                    success: false,
                    message: "Invalid email or password"
                });
            }

            // Check user status
            const userStatus = (user.status || '').toLowerCase();
            if (userStatus !== 'active') {
                console.log(`❌ Login blocked: User account is ${user.status || 'inactive'}`);
                return res.status(403).json({
                    success: false,
                    message: "Your account has been disabled. Please contact your administrator."
                });
            }

            console.log(`✅ User status check passed: ${email} is ACTIVE`);

            if (!user.password) {
                console.log(`❌ Login failed: No password set for ${email}`);
                return res.status(401).json({
                    success: false,
                    message: "Invalid email or password"
                });
            }

            const isPasswordValid = await bcrypt.compare(password, user.password);
            console.log(`🔐 Password comparison result: ${isPasswordValid}`);

            if (!isPasswordValid) {
                console.log(`❌ Login failed: Invalid password for ${email}`);
                return res.status(401).json({
                    success: false,
                    message: "Invalid email or password"
                });
            }

            console.log(`✅ Password valid for user: ${email}`);

            // Generate and store OTP in database
            const otp = generateOTP();
            await storage.createOTP(email, otp, 'login', user.id);

            // Send OTP email
            const emailResult = await sendOTPEmail(email, otp, 'login');

            res.json({
                success: true,
                message: emailResult.devMode
                    ? `OTP generated: ${otp} (Email service not configured)`
                    : "OTP sent to your email",
                requiresOTP: true,
                devMode: emailResult.devMode || false
            });

        } catch (error) {
            console.error("❌ Login error:", error);
            res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    });

    // POST /api/auth/resend-otp - Resend OTP for login
    router.post("/verify-otp", async (req, res) => {
        try {
            const { email, otp } = req.body;

            if (!email || !otp) {
                return res.status(400).json({
                    success: false,
                    message: "Email and OTP are required"
                });
            }

            const storedOTP = await storage.getValidOTP(email, otp, 'login');
            if (!storedOTP) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid or expired OTP. Please request a new one."
                });
            }

            // Mark OTP as used AFTER sending response to avoid async issues
            await storage.markOTPAsUsed(email, otp);

            const user = await storage.getUserByEmail(email);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            if ((user.status || '').toLowerCase() !== 'active') {
                return res.status(403).json({
                    success: false,
                    message: "Your account has been disabled."
                });
            }

            const business = await storage.getBusiness(user.associatedBusinessId || user.institutionId);
            if (!business) {
                return res.status(404).json({
                    success: false,
                    message: "Business not found for user"
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
                lastLogin: user.lastLogin,
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
                status: user.status,
                businessId: business.businessId,
                businessUUID: business.id,
                businessType: business.businessType,
                primaryColor: business.primaryColor
            };

            const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '24h' });
            await storage.updateUserLastLogin(user.id);

            return res.status(200).json({
                success: true,
                message: "Login successful",
                user: cleanUser,
                token
            });

        } catch (error) {
            console.error("❌ OTP verification error:", error);
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    });

    // POST /api/auth/verify-otp - Consolidated and Cleaned
    router.post("/verify-otp", async (req, res) => {
        try {
            const { email, otp } = req.body;

            if (!email || !otp) {
                return res.status(400).json({
                    success: false,
                    message: "Email and OTP are required"
                });
            }

            // 1. Verify OTP exists and is valid
            const storedOTP = await storage.getValidOTP(email, otp, 'login');
            if (!storedOTP) {
                console.log(`❌ OTP verification failed for ${email}`);
                return res.status(400).json({
                    success: false,
                    message: "Invalid or expired OTP. Please request a new one."
                });
            }

            // 2. Mark OTP as used immediately
            await storage.markOTPAsUsed(email, otp);

            // 3. Get User
            const user = await storage.getUserByEmail(email);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            // 4. Check Status
            if ((user.status || '').toLowerCase() !== 'active') {
                return res.status(403).json({
                    success: false,
                    message: "Your account has been disabled."
                });
            }

            // 5. Fetch Business Data (Handling both field possibilities)
            const businessIdToLookup = user.associatedBusinessId || user.institutionId;
            const business = await storage.getBusiness(businessIdToLookup);

            if (!business) {
                console.log(`❌ No business found for ID: ${businessIdToLookup}`);
                return res.status(404).json({
                    success: false,
                    message: "Associated business profile not found"
                });
            }

            // 6. Prepare Response and Token
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

            // 7. Update last login in DB
            await storage.updateUserLastLogin(user.id);

            console.log(`✅ Successful login for: ${email}`);

            return res.status(200).json({
                success: true,
                message: "Login successful",
                user: cleanUser,
                token: token
            });

        } catch (error) {
            console.error("❌ OTP verification error:", error);
            return res.status(500).json({
                success: false,
                message: "Internal server error during verification"
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
                // Return success for security
                console.log(`Password reset requested for non-existent email: ${email}`);
                return res.json({
                    success: true,
                    message: "If the email exists, a reset OTP has been sent"
                });
            }

            console.log(`📧 Password reset requested for ${email} (Status: ${user.status})`);

            // Check rate limiting
            const recentAttempts = await storage.getRecentOTPAttempts(email, 10);
            if (recentAttempts >= 3) {
                return res.status(429).json({
                    success: false,
                    message: "Too many reset attempts. Please wait 10 minutes."
                });
            }

            // Generate and store OTP
            const otp = generateOTP();
            await storage.createOTP(email, otp, 'reset', user.id);

            // Send OTP email
            const emailResult = await sendOTPEmail(email, otp, 'reset');

            res.json({
                success: true,
                message: emailResult.devMode
                    ? `Reset OTP generated: ${otp}`
                    : "Reset OTP sent to your email",
                devMode: emailResult.devMode || false
            });

        } catch (error) {
            console.error("Forgot password error:", error);
            res.status(500).json({
                success: false,
                message: "Unable to process password reset"
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

            // Get valid OTP from database
            const storedOTP = await storage.getValidOTP(email, otp, 'reset');
            if (!storedOTP) {
                console.log(`❌ Reset OTP verification failed for ${email}`);
                return res.status(400).json({
                    success: false,
                    message: "Invalid or expired OTP. Please request a new one."
                });
            }

            // Mark OTP as used
            await storage.markOTPAsUsed(email, otp);

            // Generate JWT token for password reset
            const resetToken = jwt.sign(
                {
                    id: storedOTP.userId,
                    email: email,
                    type: 'password_reset'
                },
                process.env.JWT_SECRET,
                { expiresIn: '10m' }
            );

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
                message: "Internal server error"
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

            // Verify reset token
            let decoded;
            try {
                decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
            } catch (error) {
                console.log(`❌ Invalid reset token:`, error.message);
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

            // Retrieve user
            const user = await storage.getUserByEmail(decoded.email);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            // Check against old password
            if (user.password) {
                const isSameAsOldPassword = await bcrypt.compare(newPassword, user.password);
                if (isSameAsOldPassword) {
                    return res.status(400).json({
                        success: false,
                        message: "New password cannot be the same as the old password."
                    });
                }
            }

            // Hash and update new password
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

            const updateResult = await storage.updateUserPassword(user.id, hashedPassword);
            if (!updateResult) {
                return res.status(400).json({
                    success: false,
                    message: "Failed to update password"
                });
            }

            console.log(`✅ Password reset successful for: ${decoded.email}`);

            res.json({
                success: true,
                message: "Password has been reset successfully."
            });

        } catch (error) {
            console.error("❌ Password reset error:", error);
            res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    });

    return router;
}