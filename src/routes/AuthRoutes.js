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

    // Email configuration
    let transporter;
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
            connectionTimeout: 10000,
            socketTimeout: 10000
        });
    }

    const sendOTPEmail = async (email, otp, type = 'login') => {
        // Always log OTP for debugging (server logs only)
        console.log(`OTP generated for ${email}: ${otp} (type: ${type})`);

        if (!transporter) {
            console.error(`Email service not configured - OTP for ${email}: ${otp}`);
            throw new Error('Email service not configured');
        }

        const subject = type === 'login' ? 'Your Login OTP - BizTrack' : 'Password Reset OTP - BizTrack';

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
            `
            };

            await transporter.sendMail(mailOptions);
            console.log(`OTP email sent successfully to ${email}`);
            return { success: true };

        } catch (error) {
            console.error(`Failed to send ${type} email to ${email}:`, error.message);
            throw new Error('Failed to send OTP email');
        }
    };

    // POST /api/auth/login - Initiate login with email/password
    router.post("/login", async (req, res) => {
        try {
            const { email, password } = req.body;

            console.log("🔐 Login attempt:", {
                email: email,
                passwordLength: password.length
            });

            if (!email || !password) {
                return res.status(400).json({
                    success: false,
                    message: "Email and password are required"
                });
            }

            const user = await storage.getUserByEmail(email);
            if (!user) {
                console.log(`❌ Login attempt failed: User not found for email ${email}`);
                return res.status(401).json({
                    success: false,
                    message: "Invalid email or password"
                });
            }

            if (!user.password) {
                console.log(`❌ Login attempt failed: No password set for user ${email}`);
                return res.status(401).json({
                    success: false,
                    message: "Invalid email or password"
                });
            }

            console.log(`🔐 User found - Stored password: ${user.password}`);
            console.log(`🔐 Stored password starts with $2b$: ${user.password.startsWith('$2b$')}`);
            console.log(`🔐 Comparing plain: '${password}' with stored hash`);

            const isPasswordValid = await bcrypt.compare(password, user.password);
            console.log(`🔐 Password comparison result: ${isPasswordValid}`);

            if (!isPasswordValid) {
                console.log(`❌ Login attempt failed: Invalid password for user ${email}`);
                return res.status(401).json({
                    success: false,
                    message: "Invalid email or password"
                });
            }

            console.log(`✅ Password valid for user: ${email}`);

            const otp = generateOTP();
            const otpExpiry = Date.now() + 10 * 60 * 1000;

            otpStore.set(email, {
                otp,
                expiry: otpExpiry,
                userId: user.id,
                userData: user
            });

            await sendOTPEmail(email, otp, 'login');

            res.json({
                success: true,
                message: "OTP sent to your email",
                requiresOTP: true
            });

        } catch (error) {
            console.error("❌ Login error:", error);

            if (error.message === 'Email service not configured') {
                return res.status(500).json({
                    success: false,
                    message: "Authentication service temporarily unavailable"
                });
            }

            res.status(500).json({
                success: false,
                message: "Internal server error"
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
                console.log(`Resend OTP attempt failed: No active session for ${email}`);
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

            res.json({
                success: true,
                message: "New OTP sent to your email"
            });

        } catch (error) {
            console.error("Resend OTP error:", error);

            if (error.message === 'Email service not configured' || error.message === 'Failed to send OTP email') {
                return res.status(500).json({
                    success: false,
                    message: "Unable to send OTP. Please try again later."
                });
            }

            res.status(500).json({
                success: false,
                message: "Failed to resend OTP"
            });
        }
    });

    // POST /api/auth/verify-otp - Verify OTP for login
    // POST /api/auth/verify-otp - Verify OTP for login
    router.post("/verify-otp", async (req, res) => {
        try {
            const { email, otp } = req.body;

            console.log("🔍 ===== OTP VERIFICATION DEBUG START =====");
            console.log("🔍 Verifying OTP for:", email);

            if (!email || !otp) {
                return res.status(400).json({
                    success: false,
                    message: "Email and OTP are required"
                });
            }

            const storedData = otpStore.get(email);

            if (!storedData) {
                console.log(`OTP verification failed: No OTP found for ${email}`);
                return res.status(400).json({
                    success: false,
                    message: "OTP not found or expired. Please request a new OTP."
                });
            }

            if (Date.now() > storedData.expiry) {
                console.log(`OTP verification failed: OTP expired for ${email}`);
                otpStore.delete(email);
                return res.status(400).json({
                    success: false,
                    message: "OTP has expired. Please request a new OTP."
                });
            }

            if (storedData.otp !== otp) {
                console.log(`OTP verification failed: Invalid OTP for ${email}`);
                return res.status(400).json({
                    success: false,
                    message: "Invalid OTP. Please check and try again."
                });
            }

            // Get fresh user data
            const userWithBusiness = await storage.getUserByEmail(email);
            console.log("🔍 Raw user data from database:", {
                id: userWithBusiness?.id,
                email: userWithBusiness?.email,
                businessId: userWithBusiness?.businessId,
                role: userWithBusiness?.role
            });

            if (!userWithBusiness) {
                console.log(`User not found after OTP verification: ${email}`);
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            // Get business data to fetch primaryColor and businessType
            let business = null;

            // Try to find business by different methods
            if (userWithBusiness.businessId) {
                console.log(`🔍 User has businessId: ${userWithBusiness.businessId}`);
                business = await storage.getBusinessById(userWithBusiness.businessId);
                console.log("🔍 Business data from businessId:", business);
            }

            // If no business found by businessId, try other methods
            if (!business) {
                console.log("🔄 No business linked to user, trying alternative methods...");

                // Method 1: Try to find business by user email
                try {
                    business = await storage.getBusinessByEmail(userWithBusiness.email);
                    console.log("🔍 Business found by user email:", business);
                } catch (error) {
                    console.log("❌ No business found by user email");
                }

                // Method 2: For Hospital_Admin, try to find any hospital business
                if (!business && userWithBusiness.role === "Hospital_Admin") {
                    console.log("🔄 User is Hospital_Admin, searching for hospital business...");
                    try {
                        // Try common hospital business IDs or names
                        const hospitalBusiness = await storage.getBusinessById("7b661bc2-c2f2-43d3-8c2d-282b6a67f702");
                        if (hospitalBusiness) {
                            console.log("✅ Found hospital business by ID:", hospitalBusiness.businessName);
                            business = hospitalBusiness;
                        }
                    } catch (error) {
                        console.log("❌ Could not find hospital business by ID");
                    }
                }
            }

            // Map role to business type and set default themes
            const roleToBusinessType = {
                "Hospital_Admin": "hospital",
                "Kiosk_Admin": "kiosk",
                "Hotel_Admin": "hotel",
                "Super_Admin": "general",
                "HOSPITAL_ADMIN": "hospital",
                "KIOSK_ADMIN": "kiosk",
                "HOTEL_ADMIN": "hotel",
                "SUPER_ADMIN": "general"
            };

            // Default business themes
            const defaultBusinessThemes = {
                "hospital": { name: "Hospital", primaryColor: "#09243e", type: "hospital" }, // Using the actual hospital color
                "kiosk": { name: "Kiosk", primaryColor: "#118eed", type: "kiosk" },
                "hotel": { name: "Hotel", primaryColor: "#dc2626", type: "hotel" },
                "general": { name: "Business", primaryColor: "#118eed", type: "general" }
            };

            const determinedBusinessType = roleToBusinessType[userWithBusiness.role] || "general";
            const defaultTheme = defaultBusinessThemes[determinedBusinessType] || defaultBusinessThemes.general;

            // ✅ FIX: Use ACTUAL business data or proper defaults
            const cleanUser = {
                id: userWithBusiness.id,
                email: userWithBusiness.email,
                firstName: userWithBusiness.firstName,
                lastName: userWithBusiness.lastName,
                role: userWithBusiness.role,
                permissions: userWithBusiness.permissions || [],
                lastLogin: userWithBusiness.lastLogin,
                // Business details
                associatedBusinessId: business ? business.id : userWithBusiness.businessId,
                businessName: business ? business.businessName : defaultTheme.name,
                businessType: business ? (business.businessType?.toLowerCase() || determinedBusinessType) : determinedBusinessType,
                primaryColor: business ? business.primaryColor : defaultTheme.primaryColor, // Use actual business color or proper default
                logo: business ? business.logoUrl : null
            };

            console.log("✅ Final user object:", {
                businessName: cleanUser.businessName,
                businessType: cleanUser.businessType,
                primaryColor: cleanUser.primaryColor,
                hasActualBusinessData: !!business,
                businessSource: business ? "database" : "default theme"
            });

            // JWT Token generation
            const token = jwt.sign(
                {
                    userId: userWithBusiness.id,
                    email: userWithBusiness.email,
                    role: userWithBusiness.role,
                    businessId: cleanUser.associatedBusinessId,
                    businessType: cleanUser.businessType,
                    primaryColor: cleanUser.primaryColor
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            otpStore.delete(email);

            // Update last login
            await storage.updateUserLastLogin(userWithBusiness.id);

            console.log(`✅ Successful login for user: ${email}`);
            console.log("===== OTP VERIFICATION DEBUG END =====");

            res.json({
                success: true,
                message: "Login successful",
                user: cleanUser,
                token: token
            });

        } catch (error) {
            console.error("❌ OTP verification error:", error);
            res.status(500).json({
                success: false,
                message: "Internal server error"
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
                // Return success even if user not found for security
                console.log(`Password reset requested for non-existent email: ${email}`);
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

            res.json({
                success: true,
                message: "Reset OTP sent to your email"
            });

        } catch (error) {
            console.error("Forgot password error:", error);

            if (error.message === 'Email service not configured' || error.message === 'Failed to send OTP email') {
                return res.status(500).json({
                    success: false,
                    message: "Unable to send reset OTP. Please try again later."
                });
            }

            res.status(500).json({
                success: false,
                message: "Internal server error"
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
                console.log(`Resend reset OTP failed: No active session for ${email}`);
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

            res.json({
                success: true,
                message: "New reset OTP sent to your email"
            });

        } catch (error) {
            console.error("Resend reset OTP error:", error);

            if (error.message === 'Email service not configured' || error.message === 'Failed to send OTP email') {
                return res.status(500).json({
                    success: false,
                    message: "Unable to send reset OTP. Please try again later."
                });
            }

            res.status(500).json({
                success: false,
                message: "Failed to resend reset OTP"
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
                console.log(`Reset OTP verification failed: No OTP found for ${email}`);
                return res.status(400).json({
                    success: false,
                    message: "OTP not found or expired. Please request a new OTP."
                });
            }

            if (Date.now() > storedData.expiry) {
                console.log(`Reset OTP verification failed: OTP expired for ${email}`);
                otpStore.delete(`reset_${email}`);
                return res.status(400).json({
                    success: false,
                    message: "OTP has expired. Please request a new OTP."
                });
            }

            if (storedData.otp !== otp) {
                console.log(`Reset OTP verification failed: Invalid OTP for ${email}`);
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
                { expiresIn: '10m' }
            );

            otpStore.delete(`reset_${email}`);

            console.log(`✅ Password reset OTP verified successfully for: ${email}`);

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

            console.log("🔄 ===== RESET PASSWORD DEBUG START =====");
            console.log("📦 Request body:", {
                resetToken: resetToken ? `${resetToken.substring(0, 20)}...` : 'missing',
                newPassword: newPassword,
                confirmPassword: confirmPassword
            });

            // 1. Verify that newPassword and confirmPassword are identical
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

            // 2. Verify Reset Token
            let decoded;
            try {
                decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
                console.log("✅ Reset token decoded:", decoded);
            } catch (error) {
                console.log(`❌ Invalid reset token:`, error.message);
                return res.status(400).json({
                    success: false,
                    message: "Invalid or expired password reset token."
                });
            }

            if (decoded.type !== 'password_reset') {
                console.log(`❌ Invalid token type for ${decoded.email}`);
                return res.status(400).json({
                    success: false,
                    message: "Invalid reset token"
                });
            }

            // 3. Retrieve User Data
            const user = await storage.getUserByEmail(decoded.email);
            if (!user) {
                console.log(`❌ User not found: ${decoded.email}`);
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            console.log("👤 User found:", {
                id: user.id,
                email: user.email,
                currentPassword: user.password ? `${user.password.substring(0, 20)}...` : 'null',
                isCurrentPasswordHashed: user.password ? user.password.startsWith('$2b$') : false
            });

            // 4. Check Against Old Password
            if (user.password) {
                const isSameAsOldPassword = await bcrypt.compare(newPassword, user.password);
                console.log(`🔐 Comparing new password with old password: ${isSameAsOldPassword}`);

                if (isSameAsOldPassword) {
                    console.log(`❌ New password cannot be the same as old password for ${decoded.email}`);
                    return res.status(400).json({
                        success: false,
                        message: "New password cannot be the same as the old password."
                    });
                }
            }

            // 5. Hash and Update New Password
            console.log(`🔐 Before hashing - User: ${decoded.email}, Plain password: ${newPassword}`);

            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

            console.log(`🔐 After hashing - Hashed password: ${hashedPassword}`);

            // ✅ FIX: Use ONLY storage.updateUserPassword - NO db.run!
            console.log("🔄 Calling storage.updateUserPassword with HASHED password...");
            const updateResult = await storage.updateUserPassword(user.id, hashedPassword);

            console.log(`🔐 Storage update result:`, updateResult);

            if (!updateResult) {
                console.log(`❌ Password reset failed: Storage update failed for ${decoded.email}`);
                return res.status(400).json({
                    success: false,
                    message: "Failed to update password"
                });
            }

            // Verify the update worked
            console.log("🔍 Verifying password update...");
            const updatedUser = await storage.getUserByEmail(decoded.email);
            console.log("🔍 After update - User password:", {
                newPassword: updatedUser.password ? `${updatedUser.password.substring(0, 20)}...` : 'null',
                isHashed: updatedUser.password ? updatedUser.password.startsWith('$2b$') : false
            });

            // Test the password verification immediately
            if (updatedUser.password) {
                const testComparison = await bcrypt.compare(newPassword, updatedUser.password);
                console.log(`🧪 Immediate password test result: ${testComparison}`);

                if (!testComparison) {
                    console.log(`❌ CRITICAL: Password verification failed immediately after reset!`);
                    return res.status(500).json({
                        success: false,
                        message: "Password reset failed - internal error"
                    });
                }
            }

            console.log("✅ ===== RESET PASSWORD SUCCESSFUL =====");

            // 6. Send Success Response
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