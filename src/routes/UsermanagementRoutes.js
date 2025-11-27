// src/routes/UsermanagementRoutes.js

import { Router } from 'express';
import { userSchema } from '../schema.js';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';

export default function UserManagementRoutes(storage) {
    const userRouter = Router();

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
        if (req.user.role === 'Biztrack_ADMIN' || req.user.role === 'Super_Admin') {
            next();
        } else {
            res.status(403).json({ 
                success: false,
                message: 'Forbidden: Insufficient privileges.' 
            });
        }
    };

    // --- Helper Functions ---

    const normalizeRole = (role) => {
        if (!role) return 'Hotel_Admin';
        return role.replace(/\s+/g, '_');
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

    // --- Route Definitions ---

    /**
     * @route POST /api/users
     * @desc Create a new user (Requires Admin)
     */
    userRouter.post('/', protect, restrictToAdmin, async (req, res) => {
        try {
            const body = req.body;

            console.log("📨 Creating user:", { 
                email: body.email, 
                username: body.username, 
                businessId: body.businessId 
            });

            // 1. Fetch the business
            const business = await storage.getBusiness(body.businessId);
            if (!business) {
                return res.status(404).json({
                    success: false,
                    message: 'Business not found.'
                });
            }

            // 2. Normalize the role
            const normalizedRole = normalizeRole(body.role);

            // 3. Generate temporary password
            const tempPassword = Math.random().toString(36).slice(-8);

            // 4. Validate with Zod schema
            const parsedData = userSchema.parse({
                username: body.username,
                firstName: body.firstName,
                lastName: body.lastName,
                email: body.email,
                phone: body.phoneNumber,
                role: normalizedRole,
                associatedBusinessId: body.businessId,
                institutionId: body.businessId,
                businessName: business.businessName,
                institutionName: business.businessName,
                password: tempPassword,
            });

            // 5. Check for unique username and email
            const existingUsername = await storage.getUserByUsername(parsedData.username);
            if (existingUsername) {
                return res.status(400).json({
                    success: false,
                    message: 'Username already exists.'
                });
            }

            const existingEmail = await storage.getUserByEmail(parsedData.email);
            if (existingEmail) {
                return res.status(400).json({
                    success: false,
                    message: 'Email already exists.'
                });
            }

            // 6. Create User in DB
            const userData = {
                ...parsedData,
                status: 'ACTIVE',
                lastLogin: 'Never',
            };

            const newUser = await storage.createUser(userData);

            // 7. Generate password reset token and send email
            const resetToken = generatePasswordResetToken();
            const emailSent = await sendPasswordResetEmail(newUser, resetToken, business);

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
                    businessName: business.businessName,
                    businessType: business.businessType,
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
     * @desc Get all users (Requires Admin)
     */
    userRouter.get('/', protect, restrictToAdmin, async (req, res) => {
        try {
            const users = await storage.getAllUsers();

            const transformedUsers = users.map(user => ({
                id: user.id || user._id,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phone: user.phone,
                role: user.role,
                status: (user.status || 'ACTIVE').toUpperCase(),
                associatedBusinessId: user.associatedBusinessId,
                institutionId: user.institutionId,
                lastLogin: user.lastLogin || 'Never',
                createdAt: user.createdAt,
            }));

            res.status(200).json({
                success: true,
                data: transformedUsers
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
     * @desc Get user by ID
     */
    userRouter.get('/:id', protect, async (req, res) => {
        try {
            const { id } = req.params;
            const user = await storage.getUser(id);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found.'
                });
            }

            // Authorization Check
            if (req.user.role !== 'Biztrack_ADMIN' && req.user.role !== 'Super_Admin' && req.user.id !== user.id) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: Not authorized to view this user.'
                });
            }

            res.status(200).json({
                success: true,
                data: {
                    id: user.id || user._id,
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    status: (user.status || 'ACTIVE').toUpperCase(),
                    associatedBusinessId: user.associatedBusinessId,
                    lastLogin: user.lastLogin || 'Never',
                }
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
    userRouter.patch('/:id', protect, async (req, res) => {
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
            if (req.user.role !== 'Biztrack_ADMIN' && req.user.role !== 'Super_Admin' && req.user.id !== existingUser.id) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: Not authorized to edit this user.'
                });
            }

            // 3. Prepare update data
            const updateData = {};

            if (body.firstName) updateData.firstName = body.firstName;
            if (body.lastName) updateData.lastName = body.lastName;
            if (body.email) updateData.email = body.email;
            if (body.phoneNumber) updateData.phone = body.phoneNumber;
            if (body.role) updateData.role = normalizeRole(body.role);
            if (body.businessId) updateData.associatedBusinessId = body.businessId;

            updateData.updatedAt = new Date().toISOString();

            // 4. Update User in DB
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
     * @route PUT /api/users/:id/status
     * @desc Toggle user status (Requires Admin)
     */
    userRouter.put('/:id/status', protect, restrictToAdmin, async (req, res) => {
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

            const updatedUser = await storage.updateUser(id, {
                status: status.toUpperCase(),
                updatedAt: new Date().toISOString()
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
    userRouter.delete('/:id', protect, restrictToAdmin, async (req, res) => {
        try {
            const { id } = req.params;

            const existingUser = await storage.getUser(id);
            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found.'
                });
            }

            // Soft delete: set user status to 'inactive'
            const archivedUser = await storage.updateUser(id, {
                status: 'INACTIVE',
                updatedAt: new Date().toISOString()
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
    userRouter.get('/email/:email', protect, async (req, res) => {
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
    userRouter.get('/username/:username', protect, async (req, res) => {
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

    /**
     * @route GET /api/users/business/:businessId
     * @desc Get all users for a specific business
     */
    userRouter.get('/business/:businessId', protect, async (req, res) => {
        try {
            const { businessId } = req.params;
            const users = await storage.getBusinessUsers(businessId);

            const transformedUsers = users.map(user => ({
                id: user.id || user._id,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phone: user.phone,
                role: user.role,
                status: (user.status || 'ACTIVE').toUpperCase(),
                associatedBusinessId: user.associatedBusinessId,
            }));

            res.status(200).json({
                success: true,
                data: transformedUsers
            });
        } catch (error) {
            console.error('Get users by business error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error.'
            });
        }
    });

    return userRouter;
}