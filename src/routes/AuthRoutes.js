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

            // ✅ CHECK USER STATUS - Only allow active users to login
            const userStatus = (user.status || '').toLowerCase();
            if (userStatus !== 'active') {
                console.log(`❌ Login attempt blocked: User account is ${user.status || 'inactive'} for email ${email}`);
                return res.status(403).json({
                    success: false,
                    message: "Your account has been disabled. Please contact your administrator."
                });
            }

            console.log(`✅ User status check passed: ${email} is ACTIVE`);

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

            // ✅ VERIFY USER IS STILL ACTIVE before resending OTP
            const user = await storage.getUserByEmail(email);
            if (!user) {
                otpStore.delete(email);
                return res.status(404).json({
                    success: false,
                    message: "User not found. Please login again."
                });
            }

            const userStatus = (user.status || '').toLowerCase();
            if (userStatus !== 'active') {
                console.log(`❌ Resend OTP blocked: User account is ${user.status || 'inactive'} for email ${email}`);
                otpStore.delete(email);
                return res.status(403).json({
                    success: false,
                    message: "Your account has been disabled. Please contact your administrator."
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
            const user = await storage.getUserByEmail(email);
            console.log("🔍 User data from database:", {
                id: user?.id,
                email: user?.email,
                status: user?.status,
                associatedBusinessId: user?.associatedBusinessId,
                institutionId: user?.institutionId,
                role: user?.role,
                firstName: user?.firstName,
                lastName: user?.lastName
            });

            if (!user) {
                console.log(`User not found after OTP verification: ${email}`);
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            // ✅ FINAL STATUS CHECK before completing login
            const userStatus = (user.status || '').toLowerCase();
            if (userStatus !== 'active') {
                console.log(`❌ Login blocked at OTP verification: User account is ${user.status || 'inactive'} for email ${email}`);
                otpStore.delete(email);
                return res.status(403).json({
                    success: false,
                    message: "Your account has been disabled. Please contact your administrator."
                });
            }

            console.log(`✅ Final status check passed: ${email} is ACTIVE`);

            // Get business data using associatedBusinessId (UUID)
            let business = null;
            let businessUUID = user.associatedBusinessId;

            console.log(`🔍 Looking up business for user with UUID:`, businessUUID);

            if (businessUUID) {
                // ✅ FIX: Use storage.getBusiness() NOT storage.getBusinessById()
                business = await storage.getBusiness(businessUUID);
            }

            // If no business found, try institutionId as fallback
            if (!business && user.institutionId) {
                console.log(`🔄 Trying institutionId as fallback: ${user.institutionId}`);
                business = await storage.getBusiness(user.institutionId);
                if (business) {
                    businessUUID = business.id;
                }
            }

            if (!business) {
                console.log(`❌ No business found for user ${email}`);
                return res.status(404).json({
                    success: false,
                    message: "Business not found for user"
                });
            }

            console.log("✅ Business found:", {
                businessUUID: business.id,
                businessId: business.businessId, // This is the NUMBER (e.g., 2)
                businessName: business.businessName,
                businessType: business.businessType,
                primaryColor: business.primaryColor
            });

            // ✅ SIMPLE USER OBJECT - Use the NUMERIC businessId
            const cleanUser = {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                status: user.status, // Include status in response
                permissions: user.permissions || [],
                lastLogin: user.lastLogin,
                // Business details - Use NUMERIC businessId
                businessId: business.businessId, // ✅ This is the NUMBER (e.g., 2)
                businessUUID: business.id, // Keep UUID for reference
                businessName: business.businessName,
                businessType: business.businessType,
                primaryColor: business.primaryColor,
                logo: business.logoUrl
            };

            console.log("✅ Final user object for login:", {
                userId: cleanUser.id,
                name: `${cleanUser.firstName} ${cleanUser.lastName}`,
                role: cleanUser.role,
                status: cleanUser.status,
                businessId: cleanUser.businessId, // Should be 2
                businessName: cleanUser.businessName,
                businessType: cleanUser.businessType
            });

            // JWT Token generation
            const tokenPayload = {
                id: user.id,
                email: user.email,
                role: user.role,
                status: user.status, // Include status in token
                businessId: business.businessId, // ✅ Store NUMERIC ID in token
                businessUUID: business.id, // Also store UUID for DB queries
                businessType: business.businessType,
                primaryColor: business.primaryColor
            };

            const token = jwt.sign(
                tokenPayload,
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            otpStore.delete(email);

            // Update last login
            await storage.updateUserLastLogin(user.id);

            console.log(`✅ Successful login for ACTIVE user: ${email}`);
            console.log(`🏪 User is working at: ${business.businessName} (ID: ${business.businessId})`);
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

            // ✅ CHECK USER STATUS - Allow password reset for inactive users
            // (They might need to reset password to reactivate their account)
            // But log it for security purposes
            const userStatus = (user.status || '').toLowerCase();
            console.log(`📧 Password reset requested for user ${email} with status: ${user.status}`);

            const otp = generateOTP();
            const otpExpiry = Date.now() + 10 * 60 * 1000;

            otpStore.set(`reset_${email}`, {
                otp,
                expiry: otpExpiry,
                userId: user.id,
                email: email,
                userStatus: user.status // Store status for reference
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
                email: email,
                userStatus: storedData.userStatus
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

            // Generate JWT token for password reset - ✅ FIXED: Use 'id' instead of 'userId'
            const resetToken = jwt.sign(
                {
                    id: storedData.userId,
                    email: email,
                    type: 'password_reset',
                    userStatus: storedData.userStatus // Include status for logging
                },
                process.env.JWT_SECRET,
                { expiresIn: '10m' }
            );

            otpStore.delete(`reset_${email}`);

            console.log(`✅ Password reset OTP verified successfully for: ${email} (Status: ${storedData.userStatus})`);

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
                status: user.status,
                currentPassword: user.password ? `${user.password.substring(0, 20)}...` : 'null',
                isCurrentPasswordHashed: user.password ? user.password.startsWith('$2b$') : false
            });

            // Note: We allow password reset for inactive users
            // This gives admins/users a way to reset passwords even if account is disabled
            console.log(`📝 Password reset proceeding for user with status: ${user.status}`);

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