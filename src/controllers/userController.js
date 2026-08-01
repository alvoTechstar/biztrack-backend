const express = require('express');
const { userSchema } = require('../utils/schema.js');
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const { createTransporter } = require('../services/mailer.js')
const { storage } = require('../utils/storage.js');


const canAccessBusiness = (user, businessId) => {
    console.log('🔍 Checking business access:', {
            userId: user?.id,
            userRole: user?.role,
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

const ALLOWED_ROLES_BY_BUSINESS_TYPE = {
    'Kiosk': ['Kiosk_Admin', 'Kiosk_Shopkeeper', 'Super_Admin', 'Biztrack_ADMIN'],
    'Hotel': ['Hotel_Admin', 'Hotel_Manager', 'Hotel_Receptionist', 'Hotel_Housekeeping', 'Hotel_Waiter', 'Hotel_Cashier', 'Super_Admin', 'Biztrack_ADMIN'],
    'Restaurant': ['Restaurant_Admin', 'Restaurant_Manager', 'Restaurant_Waiter', 'Restaurant_Chef', 'Super_Admin', 'Biztrack_ADMIN'],
    'Retail': ['Retail_Admin', 'Retail_Manager', 'Retail_Cashier', 'Retail_Sales_Associate', 'Super_Admin', 'Biztrack_ADMIN'],
    'Hospital': ['Hospital_Admin', 'Doctor', 'Nurse', 'Lab_Technician', 'Receptionist', 'Pharmacist', 'Super_Admin', 'Biztrack_ADMIN'],
    'Other': ['Super_Admin', 'Biztrack_ADMIN'],
};

const validateRoleForBusinessType = (role, businessType) => {
    const businessRoles = ALLOWED_ROLES_BY_BUSINESS_TYPE[businessType] || [];

    return businessRoles.includes(role);
};

const getRolesForBusinessType = (businessType) => {
    return ALLOWED_ROLES_BY_BUSINESS_TYPE[businessType] || [];
};

const generatePasswordResetToken = (user) => {
    return jwt.sign(
        { id: user.id || user._id, email: user.email, type: 'password_reset' },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
};

const sendPasswordResetEmail = async (user, resetToken, business) => {
    const transporter = createTransporter();

    if (!transporter) {
        console.error('Password reset email not sent: email service not configured.');
        return false;
    }

    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;

    try {
        const mailOptions = {
            from: {
                name: 'BizTrack Application',
                address: process.env.EMAIL_USER
            },
            to: user.email,
            subject: 'Set Up Your BizTrack Account',
            html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .button { display: inline-block; background: #4F46E5; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 20px 0; }
                    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; text-align: center; color: #666; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>BizTrack Application</h1>
                    </div>
                    <p>Hello ${user.firstName || user.username},</p>
                    <p>An account has been created for you at <strong>${business.businessName}</strong>. Click the button below to set your password:</p>
                    <p style="text-align:center;"><a class="button" href="${resetLink}">Set Your Password</a></p>
                    <p>This link will expire in 24 hours.</p>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} BizTrack Application</p>
                    </div>
                </div>
            </body>
            </html>
            `,
            text: `An account has been created for you at ${business.businessName}. Set your password here: ${resetLink} (expires in 24 hours).`
        };

        const sendPromise = transporter.sendMail(mailOptions);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Email sending timeout after 15 seconds')), 15000);
        });

        await Promise.race([sendPromise, timeoutPromise]);
        return true;
    } catch (error) {
        console.error('Password reset email sending failed:', error.message);
        return false;
    }
};

exports.createUser = async(req, res) => {
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
        const resetToken = generatePasswordResetToken(newUser);
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
}

exports.getAllUsers = async(req, res) => {
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
}

exports.getUserById = async(req, res) => {
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
}

exports.updateUser = async(req, res) => {
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
}

exports.updateUserById = async(req, res) => {
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
}

exports.updateStatus = async(req, res) => {
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
}

exports.deleteUser = async(req, res) => {
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
}

exports.getUserByEmail = async(req, res) => {
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
}

exports.getUserByUsername = async(req, res) => {
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
}

exports.getUsersByBusiness = async(req, res) => {
    req.params.businessId = req.params.businessId;
    return businessUsersHandler(req, res);
}

exports.byBusiness = async(req, res) => {
    return businessUsersHandler(req, res);
}

async function businessUsersHandler(req, res) {
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
}