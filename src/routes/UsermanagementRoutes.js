// src/routes/UsermanagementRoutes.js
// UPDATED VERSION with proper business-specific role validation and FIXED GET /api/users/:id

import { Router } from 'express';
import { userSchema } from '../schema.js';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import express from 'express';

export default function UserManagementRoutes(storage) {
    const router = express.Router();

    // --- Email Configuration ---
    const DEV_MODE = process.env.NODE_ENV !== 'production';

    console.log(`🔧 User Management Email Configuration:`);
    console.log(`   - NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
    console.log(`   - EMAIL_USER: ${process.env.EMAIL_USER ? 'Set' : 'Not set'}`);
    console.log(`   - EMAIL_PASS: ${process.env.EMAIL_PASS ? 'Set' : 'Not set'}`);

    let transporter;

    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        try {
            transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                },
                connectionTimeout: 10000,
                socketTimeout: 10000
            });

            console.log('✅ User Management email transporter created');
        } catch (error) {
            console.error('❌ Failed to create email transporter:', error.message);
        }
    } else {
        console.log('🔧 No email credentials found - emails will be logged to console');
    }

    // --- JWT Authentication Middleware ---
    const protect = (req, res, next) => {
        try {
            const token = req.header('Authorization')?.replace('Bearer ', '');

            if (!token) {
                return res.status(401).json({
                    success: false,
                    message: 'Access denied. No token provided.'
                });
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            next();
        } catch (error) {
            console.error('JWT verification failed:', error.message);
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
    };

    // --- Admin Authorization Middleware ---
    const restrictToAdmin = (req, res, next) => {
        const userRole = req.user.role;

        // Allow Super Admin, BizTrack Admin, and business-specific admins
        const isAdmin = userRole === 'Super_Admin' ||
            userRole === 'Biztrack_ADMIN' ||
            userRole.endsWith('_Admin');

        if (isAdmin) {
            next();
        } else {
            res.status(403).json({
                success: false,
                message: 'Forbidden: Insufficient privileges. Admin access required.'
            });
        }
    };

    // --- Helper Functions ---

    const normalizeRole = (role, businessType) => {
        if (!role) return 'Shopkeeper';

        // Convert spaces to underscores
        const normalized = role.replace(/\s+/g, '_');

        // Map generic roles to business-specific roles
        const roleMapping = {
            'Admin': (businessType) => `${businessType}_Admin`,
            'Shopkeeper': (businessType) => `${businessType}_Shopkeeper`,
            'Manager': (businessType) => `${businessType}_Manager`,
            'Receptionist': (businessType) => `${businessType}_Receptionist`,
            'Housekeeping': (businessType) => `${businessType}_Housekeeping`,
            'Waiter': (businessType) => `${businessType}_Waiter`,
            'Chef': (businessType) => `${businessType}_Chef`,
            'Cashier': (businessType) => `${businessType}_Cashier`,
            'Sales_Associate': (businessType) => `${businessType}_Sales_Associate`,
        };

        // If it's a generic role, convert to business-specific role
        if (roleMapping[normalized] && businessType) {
            return roleMapping[normalized](businessType);
        }

        return normalized;
    };

    // Role validation by business type - MATCHING YOUR ACTUAL DATA
    const validateRoleForBusinessType = (role, businessType) => {
        const allowedRoles = {
            'Kiosk': ['Kiosk_Admin', 'Kiosk_Shopkeeper', 'Super_Admin', 'Biztrack_ADMIN'],
            'Hotel': ['Hotel_Admin', 'Hotel_Manager', 'Hotel_Receptionist', 'Hotel_Housekeeping', 'Super_Admin', 'Biztrack_ADMIN'],
            'Restaurant': ['Restaurant_Admin', 'Restaurant_Manager', 'Restaurant_Waiter', 'Restaurant_Chef', 'Super_Admin', 'Biztrack_ADMIN'],
            'Retail': ['Retail_Admin', 'Retail_Manager', 'Retail_Cashier', 'Retail_Sales_Associate', 'Super_Admin', 'Biztrack_ADMIN'],
        };

        const businessRoles = allowedRoles[businessType] || [];

        return businessRoles.includes(role);
    };

    const canAccessBusiness = (user, businessId) => {
        console.log('🔍 Checking business access:', {
            userId: user.id,
            userRole: user.role,
            targetBusinessId: businessId
        });

        // SUPER ADMIN and BizTrack Admin can access all businesses
        if (user.role === 'Super_Admin' || user.role === 'Biztrack_ADMIN') {
            console.log('✅ Access granted: Super Admin / BizTrack Admin');
            return true;
        }

        // Get all possible business IDs from the user
        const userBusinessIds = [
            String(user.businessId || '').trim(),
            String(user.associatedBusinessId || '').trim(),
            String(user.institutionId || '').trim(),
            String(user.businessUUID || '').trim()
        ].filter(id => id.length > 0);

        const targetBusinessId = String(businessId || '').trim();

        console.log(`🔍 Business ID comparison:`, {
            userBusinessIds,
            targetBusinessId,
            hasMatch: userBusinessIds.includes(targetBusinessId)
        });

        // Check exact match
        if (userBusinessIds.includes(targetBusinessId)) {
            console.log('✅ Access granted: Exact business ID match');
            return true;
        }

        // Try numeric comparison
        for (const userBusinessId of userBusinessIds) {
            const userNum = parseInt(userBusinessId, 10);
            const targetNum = parseInt(targetBusinessId, 10);

            if (!isNaN(userNum) && !isNaN(targetNum) && userNum === targetNum) {
                console.log('✅ Access granted: Numeric business ID match');
                return true;
            }
        }

        console.log(`❌ Access denied: No business ID match`);
        return false;
    };

    const generatePasswordResetToken = () => {
        return jwt.sign(
            { type: 'password_reset' },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
    };

    const sendPasswordResetEmail = async (user, resetToken, business) => {
        try {
            const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

            const emailContent = `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                        <div style="text-align: center; margin-bottom: 20px;">
                            ${business?.logoUrl ? `<img src="${business.logoUrl}" alt="Logo" style="max-width: 150px; height: auto;">` : ''}
                            <h1 style="color: ${business?.primaryColor || '#1976d2'}; margin: 10px 0;">Welcome to ${business?.businessName || 'BizTrack'}!</h1>
                        </div>

                        <p>Hi <strong>${user.firstName} ${user.lastName}</strong>,</p>

                        <p>Your account has been created successfully. To get started, please set your password by clicking the link below:</p>

                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetLink}" 
                               style="background-color: ${business?.primaryColor || '#1976d2'}; 
                                      color: white; 
                                      padding: 12px 30px; 
                                      text-decoration: none; 
                                      border-radius: 5px; 
                                      display: inline-block;
                                      font-weight: bold;">
                                Set Your Password
                            </a>
                        </div>

                        <p style="color: #666; font-size: 12px;">
                            This link will expire in 24 hours. If you didn't create this account, please ignore this email.
                        </p>

                        <p style="color: #666; font-size: 12px; margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px;">
                            <strong>Account Details:</strong><br>
                            Username: ${user.username}<br>
                            Email: ${user.email}<br>
                            Business: ${business?.businessName || 'N/A'}<br>
                            Role: ${user.role?.replace(/_/g, ' ') || 'N/A'}
                        </p>
                    </div>
                </div>
            `;

            if (!transporter) {
                console.log(`📧 [CONSOLE] Password reset for ${user.email}: ${resetLink}`);
                return true;
            }

            await transporter.sendMail({
                from: {
                    name: 'BizTrack',
                    address: process.env.EMAIL_USER
                },
                to: user.email,
                subject: `Welcome to ${business?.businessName || 'BizTrack'} - Set Your Password`,
                html: emailContent
            });

            console.log(`✅ Password reset email sent to ${user.email}`);
            return true;
        } catch (error) {
            console.error('❌ Failed to send email:', error.message);
            console.log(`📧 [FALLBACK] Password reset for ${user.email}: ${resetLink}`);
            return false;
        }
    };

    // Helper function to transform user for response
    function transformUserForResponse(user) {
        const userObj = user.toObject ? user.toObject() : user;

        return {
            id: userObj.id || userObj._id,
            username: userObj.username,
            firstName: userObj.firstName,
            lastName: userObj.lastName,
            email: userObj.email,
            phone: userObj.phone,
            role: userObj.role,
            status: (userObj.status || 'ACTIVE').toUpperCase(),
            businessId: userObj.businessId,
            associatedBusinessId: userObj.associatedBusinessId,
            businessUUID: userObj.businessUUID,
            institutionId: userObj.institutionId,
            lastLogin: userObj.lastLogin || 'Never',
            businessName: userObj.businessName,
            createdAt: userObj.createdAt,
        };
    }

    // Helper function to get roles for business type
    function getRolesForBusinessType(businessType) {
        const roleMapping = {
            'Kiosk': ['Kiosk_Admin', 'Kiosk_Shopkeeper'],
            'Hotel': ['Hotel_Admin', 'Hotel_Waiter', 'Hotel_Cashier'],
            'Restaurant': ['Restaurant_Admin', 'Restaurant_Manager', 'Restaurant_Waiter', 'Restaurant_Chef'],
            'Retail': ['Retail_Admin', 'Retail_Manager', 'Retail_Cashier', 'Retail_Sales_Associate'],
        };
        return roleMapping[businessType] || ['Admin'];
    }

    // --- Route Definitions ---

    router.post('/create-user', protect, restrictToAdmin, async (req, res) => {
        try {
            const body = req.body;

            console.log("📨 Creating user:", {
                email: body.email,
                username: body.username,
                businessId: body.businessId,
                businessIdType: typeof body.businessId,
                requestedBy: req.user.id,
                requestedRole: req.user.role
            });

            // 1. Validate business access
            if (!canAccessBusiness(req.user, body.businessId)) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only create users for your assigned business.'
                });
            }

            // 2. Fetch the business
            const business = await storage.getBusiness(body.businessId);
            if (!business) {
                return res.status(404).json({
                    success: false,
                    message: 'Business not found.'
                });
            }

            const businessObj = business.toObject ? business.toObject() : business;

            console.log('✅ Found business:', {
                name: businessObj.businessName,
                businessId: businessObj.businessId,
                id: businessObj.id
            });

            // 3. Normalize the role based on business type
            const normalizedRole = normalizeRole(body.role, businessObj.businessType);

            // 4. Validate role for business type
            if (!validateRoleForBusinessType(normalizedRole, businessObj.businessType)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid role "${body.role}" for business type "${businessObj.businessType}".`,
                    allowedRoles: getRolesForBusinessType(businessObj.businessType)
                });
            }

            // 5. Generate temporary password
            const tempPassword = Math.random().toString(36).slice(-8);

            // 6. CRITICAL FIX: Prepare data with NUMERIC businessId
            const userData = {
                username: body.username,
                firstName: body.firstName,
                lastName: body.lastName,
                email: body.email,
                phone: body.phoneNumber,
                role: normalizedRole,
                password: tempPassword,

                // CRITICAL: Store as NUMERIC
                businessId: parseInt(businessObj.businessId, 10),

                // Also store UUID for compatibility
                businessUUID: businessObj.id || businessObj.businessUUID,

                // Keep string versions for backward compatibility
                associatedBusinessId: String(businessObj.businessId),
                institutionId: String(businessObj.businessId),

                // Business metadata
                businessName: businessObj.businessName,
                institutionName: businessObj.businessName,

                status: 'ACTIVE',
                lastLogin: 'Never',
                createdBy: req.user.id,
                createdAt: new Date().toISOString(),
            };

            console.log('📦 User data to be saved:', {
                username: userData.username,
                businessId: userData.businessId,
                businessIdType: typeof userData.businessId,
                businessUUID: userData.businessUUID,
                associatedBusinessId: userData.associatedBusinessId
            });

            // 7. Check for unique username and email
            const existingUsername = await storage.getUserByUsername(userData.username);
            if (existingUsername) {
                return res.status(400).json({
                    success: false,
                    message: 'Username already exists.'
                });
            }

            const existingEmail = await storage.getUserByEmail(userData.email);
            if (existingEmail) {
                return res.status(400).json({
                    success: false,
                    message: 'Email already exists.'
                });
            }

            // 8. Create User in DB
            const newUser = await storage.createUser(userData);

            console.log('✅ User created:', {
                id: newUser.id || newUser._id,
                username: newUser.username,
                businessId: newUser.businessId,
                businessIdType: typeof newUser.businessId
            });

            // 9. Generate password reset token and send email
            const resetToken = generatePasswordResetToken();
            const emailSent = await sendPasswordResetEmail(newUser, resetToken, businessObj);

            console.log(`✅ User created successfully: ${newUser.username} for business: ${businessObj.businessName}`);

            res.status(201).json({
                success: true,
                message: emailSent
                    ? 'User created successfully. Password reset email sent.'
                    : 'User created successfully. Email notification failed.',
                user: {
                    id: newUser.id || newUser._id,
                    username: newUser.username,
                    firstName: newUser.firstName,
                    lastName: newUser.lastName,
                    email: newUser.email,
                    phone: newUser.phone,
                    role: newUser.role,
                    status: newUser.status,
                    businessId: newUser.businessId,
                    businessUUID: newUser.businessUUID,
                    businessName: businessObj.businessName,
                    businessType: businessObj.businessType,
                },
                emailSent
            });

        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error("❌ Validation Error:", error.errors);
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: error.errors
                });
            }
            console.error('🚨 User creation error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error during user creation.',
                error: error.message
            });
        }
    });

    /**
 * @route GET /api/users
 * @desc Get all users (with proper filtering)
 */
    router.get('/', protect, restrictToAdmin, async (req, res) => {
        try {
            const currentUser = req.user;

            console.log('🔍 Fetching users request from:', {
                userId: currentUser.id,
                role: currentUser.role,
                businessId: currentUser.businessId,
                businessUUID: currentUser.businessUUID
            });

            let users = await storage.getAllUsers();

            // FILTER BASED ON USER ROLE
            if (currentUser.role === 'Super_Admin' || currentUser.role === 'Biztrack_ADMIN') {
                // Super Admins see all users
                console.log(`👑 ${currentUser.role}: Showing all ${users.length} users`);
            }
            else if (currentUser.role.endsWith('_Admin')) {
                // Business-specific admins (Kiosk_Admin, Hotel_Admin, etc.)
                const userNumericId = String(currentUser.businessId || '').trim();
                const userUUID = String(currentUser.businessUUID || '').trim();

                users = users.filter(user => {
                    const userObj = user.toObject ? user.toObject() : user;

                    // Check all possible business ID fields in the user
                    const userBusinessNumericId = String(userObj.businessId || '').trim();
                    const userBusinessUUID = String(userObj.businessUUID || '').trim();
                    const userAssociatedBusinessId = String(userObj.associatedBusinessId || '').trim();

                    // User belongs to current admin's business if any of these match
                    return userBusinessNumericId === userNumericId ||
                        userBusinessUUID === userUUID ||
                        userAssociatedBusinessId === userNumericId ||
                        userAssociatedBusinessId === userUUID;
                });

                console.log(`🏢 ${currentUser.role}: Filtered to ${users.length} users for business ${userNumericId}/${userUUID}`);
            }
            else {
                // Non-admin users shouldn't reach here due to restrictToAdmin middleware
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: Insufficient privileges.'
                });
            }

            const transformedUsers = users.map(user => {
                const userObj = user.toObject ? user.toObject() : user;
                return {
                    id: userObj.id || userObj._id,
                    username: userObj.username,
                    firstName: userObj.firstName,
                    lastName: userObj.lastName,
                    email: userObj.email,
                    phone: userObj.phone,
                    role: userObj.role,
                    status: (userObj.status || 'ACTIVE').toUpperCase(),
                    businessId: userObj.businessId,
                    businessUUID: userObj.businessUUID,
                    associatedBusinessId: userObj.associatedBusinessId,
                    institutionId: userObj.institutionId,
                    businessName: userObj.businessName,
                    lastLogin: userObj.lastLogin || 'Never',
                    createdAt: userObj.createdAt,
                };
            });

            res.status(200).json({
                success: true,
                data: transformedUsers,
                count: transformedUsers.length,
                userRole: currentUser.role,
                filteredByBusiness: currentUser.role.endsWith('_Admin')
            });
        } catch (error) {
            console.error('Get users error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error.'
            });
        }
    });

    /**
     * @route GET /api/users/:id
     * @desc Get user by ID - FIXED VERSION with business lookup
     */
    router.get('/:id', protect, async (req, res) => {
        try {
            const { id } = req.params;
            const user = await storage.getUser(id);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found.'
                });
            }

            const userObj = user.toObject ? user.toObject() : user;

            // Authorization Check
            // Super Admins can view anyone
            if (req.user.role === 'Super_Admin' || req.user.role === 'Biztrack_ADMIN') {
                return res.status(200).json({
                    success: true,
                    data: transformUserForResponse(user)
                });
            }

            // Business Admins can only view users in their business
            if (req.user.role.endsWith('_Admin')) {
                // Get all possible admin business IDs
                const adminBusinessIds = [
                    String(req.user.businessId || '').trim(),
                    String(req.user.businessUUID || '').trim(),
                    String(req.user.associatedBusinessId || '').trim(),
                    String(req.user.institutionId || '').trim()
                ].filter(id => id.length > 0);

                // Get all possible user business IDs
                const userBusinessIds = [
                    String(userObj.businessId || '').trim(),
                    String(userObj.businessUUID || '').trim(),
                    String(userObj.associatedBusinessId || '').trim(),
                    String(userObj.institutionId || '').trim()
                ].filter(id => id.length > 0);

                console.log('🔍 Business Admin Access Check:', {
                    adminRole: req.user.role,
                    adminBusinessIds,
                    userId: id,
                    userRole: userObj.role,
                    userBusinessIds
                });

                // Check for any exact string match
                const hasStringMatch = adminBusinessIds.some(adminId =>
                    userBusinessIds.includes(adminId)
                );

                if (hasStringMatch) {
                    console.log('✅ Access granted: String business ID match');
                    return res.status(200).json({
                        success: true,
                        data: transformUserForResponse(user)
                    });
                }

                // Check for numeric match (in case one is "123" and the other is 123)
                const adminNumericIds = adminBusinessIds
                    .map(id => parseInt(id, 10))
                    .filter(id => !isNaN(id));

                const userNumericIds = userBusinessIds
                    .map(id => parseInt(id, 10))
                    .filter(id => !isNaN(id));

                const hasNumericMatch = adminNumericIds.some(adminId =>
                    userNumericIds.includes(adminId)
                );

                if (hasNumericMatch) {
                    console.log('✅ Access granted: Numeric business ID match');
                    return res.status(200).json({
                        success: true,
                        data: transformUserForResponse(user)
                    });
                }

                // FINAL FALLBACK: Try to fetch both businesses and compare their actual IDs
                // This handles the case where admin has numeric ID but user has UUID
                console.log('🔄 No direct match - trying business lookup...');

                try {
                    // Try to fetch admin's business
                    let adminBusiness = null;
                    for (const adminBusinessId of adminBusinessIds) {
                        try {
                            adminBusiness = await storage.getBusiness(adminBusinessId);
                            if (adminBusiness) {
                                console.log('✅ Found admin business:', adminBusinessId);
                                break;
                            }
                        } catch (err) {
                            console.log(`Could not fetch business ${adminBusinessId}`);
                        }
                    }

                    // Try to fetch user's business
                    let userBusiness = null;
                    for (const userBusinessId of userBusinessIds) {
                        try {
                            userBusiness = await storage.getBusiness(userBusinessId);
                            if (userBusiness) {
                                console.log('✅ Found user business:', userBusinessId);
                                break;
                            }
                        } catch (err) {
                            console.log(`Could not fetch business ${userBusinessId}`);
                        }
                    }

                    if (adminBusiness && userBusiness) {
                        const adminBusinessObj = adminBusiness.toObject ? adminBusiness.toObject() : adminBusiness;
                        const userBusinessObj = userBusiness.toObject ? userBusiness.toObject() : userBusiness;

                        // Compare all business ID fields
                        const adminBizIds = [
                            String(adminBusinessObj.businessId || ''),
                            String(adminBusinessObj.id || ''),
                            String(adminBusinessObj.businessUUID || '')
                        ].filter(id => id.length > 0);

                        const userBizIds = [
                            String(userBusinessObj.businessId || ''),
                            String(userBusinessObj.id || ''),
                            String(userBusinessObj.businessUUID || '')
                        ].filter(id => id.length > 0);

                        console.log('🔍 Comparing fetched businesses:', {
                            adminBizIds,
                            userBizIds
                        });

                        // Check if any admin business ID matches any user business ID
                        const businessMatch = adminBizIds.some(adminId => userBizIds.includes(adminId));

                        // Also check numeric match for business IDs
                        const adminBizNumeric = adminBizIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
                        const userBizNumeric = userBizIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
                        const numericBusinessMatch = adminBizNumeric.some(adminId => userBizNumeric.includes(adminId));

                        if (businessMatch || numericBusinessMatch) {
                            console.log('✅ Access granted: Business lookup match');
                            return res.status(200).json({
                                success: true,
                                data: transformUserForResponse(user)
                            });
                        }
                    }
                } catch (businessLookupError) {
                    console.error('Error during business lookup:', businessLookupError);
                }

                console.log('❌ Access denied: No business ID match found');
                console.log('Debug info:', {
                    adminBusinessIds,
                    userBusinessIds,
                    adminNumericIds,
                    userNumericIds
                });

                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: Not authorized to view this user.'
                });
            }

            // Regular users can only view themselves
            const userIdToCheck = userObj.id || userObj._id;
            if (req.user.id !== userIdToCheck) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: Not authorized to view this user.'
                });
            }

            // User is viewing themselves
            res.status(200).json({
                success: true,
                data: transformUserForResponse(user)
            });

        } catch (error) {
            console.error('Get user error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error.'
            });
        }
    });

    /**
     * @route PATCH /api/users/:id
     * @desc Update user details
     */
    router.patch('/:id', protect, async (req, res) => {
        try {
            const { id } = req.params;
            const body = req.body;

            console.log("📨 Updating user:", id);

            // 1. Fetch existing user
            const existingUser = await storage.getUser(id);
            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found.'
                });
            }

            // 2. Authorization Check
            // Super Admins can edit anyone
            // Business Admins can only edit users in their business
            // Regular users can only edit themselves
            if (req.user.role !== 'Super_Admin' && req.user.role !== 'Biztrack_ADMIN') {
                if (req.user.role.endsWith('_Admin')) {
                    // Business Admin: check if same business
                    const adminBusinessId = String(req.user.associatedBusinessId || '').trim();
                    const userBusinessId = String(existingUser.associatedBusinessId || '').trim();

                    if (adminBusinessId !== userBusinessId) {
                        return res.status(403).json({
                            success: false,
                            message: 'Forbidden: Not authorized to edit this user.'
                        });
                    }
                } else if (req.user.id !== existingUser.id) {
                    // Regular user: can only edit themselves
                    return res.status(403).json({
                        success: false,
                        message: 'Forbidden: Not authorized to edit this user.'
                    });
                }
            }

            // 3. Validate business change (if attempting to change business)
            if (body.businessId && body.businessId !== existingUser.associatedBusinessId) {
                if (!canAccessBusiness(req.user, body.businessId)) {
                    return res.status(403).json({
                        success: false,
                        message: 'You cannot move users to a different business.'
                    });
                }
            }

            // 4. Validate role change (if attempting to change role)
            if (body.role) {
                const businessId = body.businessId || existingUser.associatedBusinessId;
                const business = await storage.getBusiness(businessId);

                if (business && !validateRoleForBusinessType(body.role, business.businessType)) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid role "${body.role}" for business type "${business.businessType}".`
                    });
                }
            }

            // 5. Prepare update data
            const updateData = {};

            if (body.firstName) updateData.firstName = body.firstName;
            if (body.lastName) updateData.lastName = body.lastName;
            if (body.email) updateData.email = body.email;
            if (body.phoneNumber) updateData.phone = body.phoneNumber;
            if (body.role) updateData.role = body.role;
            if (body.businessId) updateData.associatedBusinessId = body.businessId;

            updateData.updatedAt = new Date().toISOString();
            updateData.updatedBy = req.user.id;

            // 6. Update User in DB
            const updatedUser = await storage.updateUser(id, updateData);

            if (!updatedUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found after update attempt.'
                });
            }

            res.status(200).json({
                success: true,
                message: 'User updated successfully.',
                data: {
                    id: updatedUser.id || updatedUser._id,
                    username: updatedUser.username,
                    firstName: updatedUser.firstName,
                    lastName: updatedUser.lastName,
                    email: updatedUser.email,
                    phone: updatedUser.phone,
                    role: updatedUser.role,
                    status: updatedUser.status,
                }
            });

        } catch (error) {
            console.error('🚨 User update error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error during user update.',
                error: error.message
            });
        }
    });

   /**
 * @route PUT /api/users/update-user/:id
 * @desc Update user details (used by frontend)
 */
router.put('/update-user/:id', protect, restrictToAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body;

        console.log("📨 PUT /update-user/:id - Updating user:", id);

        // 1. Fetch existing user
        const existingUser = await storage.getUser(id);
        if (!existingUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found.'
            });
        }

        const existingUserObj = existingUser.toObject ? existingUser.toObject() : existingUser;

        // 2. Authorization Check - Check ALL business ID fields
        if (req.user.role !== 'Super_Admin' && req.user.role !== 'Biztrack_ADMIN') {
            if (req.user.role.endsWith('_Admin')) {
                const adminBusinessIds = [
                    String(req.user.businessId || '').trim(),
                    String(req.user.businessUUID || '').trim(),
                    String(req.user.associatedBusinessId || '').trim()
                ].filter(id => id.length > 0);

                const userBusinessIds = [
                    String(existingUserObj.businessId || '').trim(),
                    String(existingUserObj.businessUUID || '').trim(),
                    String(existingUserObj.associatedBusinessId || '').trim()
                ].filter(id => id.length > 0);

                const hasMatch = adminBusinessIds.some(adminId => userBusinessIds.includes(adminId));
                const adminNumericIds = adminBusinessIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
                const userNumericIds = userBusinessIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
                const hasNumericMatch = adminNumericIds.some(adminId => userNumericIds.includes(adminId));

                if (!hasMatch && !hasNumericMatch) {
                    console.log('❌ Authorization failed:', { adminBusinessIds, userBusinessIds });
                    return res.status(403).json({
                        success: false,
                        message: 'Forbidden: Not authorized to edit this user.'
                    });
                }
                console.log('✅ Authorization passed');
            } else if (req.user.id !== (existingUserObj.id || existingUserObj._id)) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: Not authorized to edit this user.'
                });
            }
        }

        // 3. Validate role change (if attempting to change role)
        if (body.role) {
            const businessId = body.businessId || existingUserObj.associatedBusinessId || existingUserObj.businessId;
            const business = await storage.getBusiness(businessId);

            if (business && !validateRoleForBusinessType(body.role, business.businessType)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid role "${body.role}" for business type "${business.businessType}".`
                });
            }
        }

        // 4. Prepare update data
        const updateData = {};
        if (body.firstName) updateData.firstName = body.firstName;
        if (body.lastName) updateData.lastName = body.lastName;
        if (body.email) updateData.email = body.email;
        if (body.phoneNumber) updateData.phone = body.phoneNumber;
        if (body.role) updateData.role = body.role;
        
        updateData.updatedAt = new Date().toISOString();
        updateData.updatedBy = req.user.id;

        console.log('📦 Update data:', updateData);

        // 5. Update User in DB
        const updatedUser = await storage.updateUser(id, updateData);

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found after update attempt.'
            });
        }

        const updatedUserObj = updatedUser.toObject ? updatedUser.toObject() : updatedUser;

        console.log('✅ User updated successfully');

        res.status(200).json({
            success: true,
            message: 'User updated successfully.',
            data: {
                id: updatedUserObj.id || updatedUserObj._id,
                username: updatedUserObj.username,
                firstName: updatedUserObj.firstName,
                lastName: updatedUserObj.lastName,
                email: updatedUserObj.email,
                phone: updatedUserObj.phone,
                role: updatedUserObj.role,
                status: updatedUserObj.status,
            }
        });

    } catch (error) {
        console.error('🚨 User update error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during user update.',
            error: error.message
        });
    }
});

    /**
     * @route PUT /api/users/:id/status
     * @desc Toggle user status (Requires Admin)
     */
    router.put('/:id/status', protect, restrictToAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!status || !['active', 'inactive'].includes(status.toLowerCase())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid status provided. Must be active or inactive.'
                });
            }

            const existingUser = await storage.getUser(id);
            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found.'
                });
            }

            // Validate business access
            if (!canAccessBusiness(req.user, existingUser.associatedBusinessId)) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only manage users in your business.'
                });
            }

            const updatedUser = await storage.updateUser(id, {
                status: status.toUpperCase(),
                updatedAt: new Date().toISOString(),
                updatedBy: req.user.id
            });

            if (!updatedUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found after status update attempt.'
                });
            }

            res.status(200).json({
                success: true,
                message: `User status updated to ${status.toUpperCase()}.`,
                data: {
                    id: updatedUser.id || updatedUser._id,
                    username: updatedUser.username,
                    status: updatedUser.status,
                }
            });

        } catch (error) {
            console.error('Status update error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error during status update.'
            });
        }
    });

    /**
     * @route DELETE /api/users/:id
     * @desc Archive user (Requires Admin)
     */
    router.delete('/:id', protect, restrictToAdmin, async (req, res) => {
        try {
            const { id } = req.params;

            const existingUser = await storage.getUser(id);
            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found.'
                });
            }

            // Validate business access
            if (!canAccessBusiness(req.user, existingUser.associatedBusinessId)) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only delete users in your business.'
                });
            }

            // Soft delete: set user status to 'inactive'
            const archivedUser = await storage.updateUser(id, {
                status: 'INACTIVE',
                updatedAt: new Date().toISOString(),
                deletedBy: req.user.id,
                deletedAt: new Date().toISOString()
            });

            res.status(200).json({
                success: true,
                message: `User "${archivedUser.firstName} ${archivedUser.lastName}" has been archived.`,
                data: {
                    id: archivedUser.id || archivedUser._id,
                    username: archivedUser.username,
                    status: archivedUser.status,
                }
            });

        } catch (error) {
            console.error('User archive error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error during user deletion.'
            });
        }
    });

    /**
     * @route GET /api/users/email/:email
     * @desc Get user by email
     */
    router.get('/email/:email', protect, async (req, res) => {
        try {
            const { email } = req.params;
            const user = await storage.getUserByEmail(email);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found.'
                });
            }

            res.status(200).json({
                success: true,
                data: user
            });
        } catch (error) {
            console.error('Get user by email error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error.'
            });
        }
    });

    /**
     * @route GET /api/users/username/:username
     * @desc Get user by username
     */
    router.get('/username/:username', protect, async (req, res) => {
        try {
            const { username } = req.params;
            const user = await storage.getUserByUsername(username);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found.'
                });
            }

            res.status(200).json({
                success: true,
                data: user
            });
        } catch (error) {
            console.error('Get user by username error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error.'
            });
        }
    });

    router.get('/business/:businessId', protect, async (req, res) => {
        try {
            const { businessId } = req.params;
            const currentUser = req.user;

            console.log('🔍 ===== GET BUSINESS USERS (SIMPLE NUMERIC) =====');
            console.log('📊 Requested Business ID:', businessId, typeof businessId);
            console.log('👤 Current User:', {
                id: currentUser.id,
                role: currentUser.role,
                businessId: currentUser.businessId
            });

            // Convert businessId to number
            const businessIdNum = parseInt(businessId, 10);

            if (isNaN(businessIdNum)) {
                console.log('❌ Invalid business ID format:', businessId);
                return res.status(400).json({
                    success: false,
                    message: 'Invalid business ID format'
                });
            }

            console.log('✅ Parsed businessId as number:', businessIdNum);

            // AUTHORIZATION
            if (currentUser.role !== 'Super_Admin' && currentUser.role !== 'Biztrack_ADMIN') {
                if (currentUser.role.endsWith('_Admin')) {
                    const userBusinessId = parseInt(currentUser.businessId, 10);

                    console.log('🔐 Authorization check:', {
                        userBusinessId,
                        requestedBusinessId: businessIdNum,
                        match: userBusinessId === businessIdNum
                    });

                    if (isNaN(userBusinessId) || userBusinessId !== businessIdNum) {
                        console.log('❌ Access denied: Business ID mismatch');
                        return res.status(403).json({
                            success: false,
                            message: 'Forbidden: You can only access your own business users.'
                        });
                    }
                } else {
                    console.log('❌ Access denied: Not an admin');
                    return res.status(403).json({
                        success: false,
                        message: 'Forbidden: Admin access required.'
                    });
                }
            }

            console.log('✅ Authorization passed');

            // GET BUSINESS INFO
            console.log('🔍 Looking up business...');
            const business = await storage.getBusiness(businessIdNum.toString());

            if (!business) {
                console.log('❌ Business not found:', businessIdNum);
                return res.status(404).json({
                    success: false,
                    message: 'Business not found.'
                });
            }

            const businessObj = business.toObject ? business.toObject() : business;
            console.log('✅ Found business:', {
                name: businessObj.businessName,
                businessId: businessObj.businessId,
                type: businessObj.businessType
            });

            // GET ALL USERS
            console.log('🔍 Fetching all users...');
            const allUsers = await storage.getAllUsers();
            console.log(`📊 Total users in database: ${allUsers.length}`);

            // FILTER USERS BY NUMERIC businessId ONLY
            const businessUsers = allUsers.filter(user => {
                const userObj = user.toObject ? user.toObject() : user;

                // Get numeric businessId from user
                const userBusinessId = userObj.businessId !== undefined ? parseInt(userObj.businessId, 10) : NaN;

                const matches = !isNaN(userBusinessId) && userBusinessId === businessIdNum;

                if (matches) {
                    console.log(`✅ User ${userObj.username} matches business ${businessIdNum}:`, {
                        userBusinessId,
                        role: userObj.role
                    });
                }

                return matches;
            });

            console.log(`✅ Found ${businessUsers.length} users for business ${businessIdNum}`);

            // Debug: Show all users if none found
            if (businessUsers.length === 0) {
                console.log('⚠️ No users found for business', businessIdNum);
                console.log('📋 All users in database:');
                allUsers.forEach(u => {
                    const uObj = u.toObject ? u.toObject() : u;
                    console.log('  -', {
                        username: uObj.username,
                        businessId: uObj.businessId,
                        businessIdType: typeof uObj.businessId,
                        role: uObj.role
                    });
                });
            }

            // TRANSFORM USERS
            const transformedUsers = businessUsers.map(user => {
                const userObj = user.toObject ? user.toObject() : user;

                return {
                    id: userObj._id || userObj.id,
                    username: userObj.username,
                    firstName: userObj.firstName || "",
                    lastName: userObj.lastName || "",
                    email: userObj.email || "",
                    phone: userObj.phone || "",
                    role: userObj.role,
                    status: (userObj.status || 'ACTIVE').toUpperCase(),
                    businessId: businessIdNum,
                    businessName: businessObj.businessName,
                    businessType: businessObj.businessType,
                    createdAt: userObj.createdAt || new Date().toISOString(),
                    lastLogin: userObj.lastLogin || 'Never'
                };
            });

            console.log(`✅ Returning ${transformedUsers.length} users`);
            console.log('==========================================');

            // RETURN RESPONSE
            res.status(200).json({
                success: true,
                data: transformedUsers,
                businessName: businessObj.businessName,
                businessType: businessObj.businessType,
                businessId: businessIdNum,
                count: transformedUsers.length,
                accessedBy: currentUser.role
            });

        } catch (error) {
            console.error('❌ Get users by business error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error.',
                error: error.message
            });
        }
    });

    return router;
}