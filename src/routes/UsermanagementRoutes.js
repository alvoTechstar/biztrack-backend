import express from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";

// Export a function that creates and returns the router
export default function UserManagementRoutes(storage) {
  if (!storage) {
    throw new Error("Storage instance must be provided to the router.");
  }

  // Enhanced debug: Check if storage is properly instantiated
  console.log("Storage instance type:", storage.constructor?.name);
  console.log("Storage methods available:", {
    getBusinessByName: typeof storage.getBusinessByName,
    createBusiness: typeof storage.createBusiness,
    getUserByUsername: typeof storage.getUserByUsername,
    createUser: typeof storage.createUser
  });

  // Validate that required methods exist
  const requiredMethods = ['getBusinessByName', 'createBusiness', 'getUserByUsername', 'createUser'];
  const missingMethods = requiredMethods.filter(method => typeof storage[method] !== 'function');

  if (missingMethods.length > 0) {
    throw new Error(`Storage instance missing required methods: ${missingMethods.join(', ')}`);
  }

  const router = express.Router();

  // Helper to extract data from MongoDB document (handles _doc)
  const extractUserData = (user) => {
    if (!user) return null;
    
    // If it's a Mongoose document with _doc
    const userData = user._doc || user;
    
    return {
      id: userData.id || userData._id?.toString() || userData.userId,
      firstName: userData.firstName || userData.firstname || '',
      lastName: userData.lastName || userData.lastname || '',
      email: userData.email || '',
      username: userData.username || userData.userName || '',
      phoneNumber: userData.phone || userData.phoneNumber || '',
      role: userData.role || userData.userRole || '',
      businessId: userData.associatedBusinessId || userData.businessId || userData.institutionId || '',
      status: (userData.status || 'ACTIVE').toUpperCase(),
      lastLogin: userData.lastLogin || null,
      createdAt: userData.createdAt,
      updatedAt: userData.updatedAt,
      passwordResetRequired: userData.passwordResetRequired || false
    };
  };

  // User schema validation (NO PASSWORD REQUIRED)
  const validateUserData = (data, isUpdate = false) => {
    const errors = [];

    if (!data.firstName?.trim()) {
      errors.push("First name is required");
    }

    if (!data.lastName?.trim()) {
      errors.push("Last name is required");
    }

    if (!data.email?.trim()) {
      errors.push("Email is required");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.push("Invalid email format");
    }

    if (!data.username?.trim()) {
      errors.push("Username is required");
    }

    if (!data.phoneNumber?.trim()) {
      errors.push("Phone number is required");
    }

    if (!data.role?.trim()) {
      errors.push("Role is required");
    }

    if (!data.businessId?.trim()) {
      errors.push("Business ID is required");
    }

    return errors;
  };

  // Helper function to generate a temporary password
  const generateTemporaryPassword = () => {
    return randomUUID().slice(0, 12);
  };

  // Helper function to send password reset email (placeholder)
  const sendPasswordSetupEmail = async (user, temporaryPassword) => {
    console.log('📧 Password Setup Email:');
    console.log('   To:', user.email);
    console.log('   Name:', `${user.firstName} ${user.lastName}`);
    console.log('   Username:', user.username);
    console.log('   Temporary Password:', temporaryPassword);
    console.log('   Reset Link: http://your-domain.com/reset-password?token=GENERATED_TOKEN');
    
    return {
      sent: true,
      message: 'Password setup email would be sent here'
    };
  };

  // Add role normalization function
  const normalizeRole = (role) => {
    const roleMap = {
      'Hotel Admin': 'Hotel_Admin',
      'Hotel Cashier': 'Hotel_Cashier',
      'Hotel Waiter': 'Hotel_Waiter',
      'Kiosk Admin': 'Kiosk_Admin',
      'Kiosk Shopkeeper': 'Kiosk_Shopkeeper',
      'Hospital Admin': 'Hospital_Admin',
      'Lab Technician': 'Lab_Technician',
      'Super Admin': 'Super_Admin',
      'Biztrack Admin': 'Biztrack_ADMIN',
      'System Admin': 'System_Admin',
      'Support Staff': 'Support_Staff',
      'Doctor': 'Doctor',
      'Nurse': 'Nurse',
      'Receptionist': 'Receptionist',
      'Pharmacist': 'Pharmacist'
    };

    return roleMap[role] || role;
  };

  // GET / - Get all users (Changed from /users to /)
  router.get("/", async (req, res) => {
    try {
      console.log("🔍 Fetching all users...");
      
      let users = [];
      
      // Try to get users from storage
      if (typeof storage.getUsers === 'function') {
        users = await storage.getUsers();
      } else if (typeof storage.getAllUsers === 'function') {
        users = await storage.getAllUsers();
      } else {
        console.error("❌ No user retrieval method found on storage");
        return res.status(501).json({
          success: false,
          message: "User retrieval not implemented"
        });
      }

      console.log(`📦 Raw users from storage (${users?.length || 0}):`, 
        users?.slice(0, 2).map(u => ({
          hasDoc: !!u._doc,
          keys: Object.keys(u._doc || u).slice(0, 5)
        }))
      );

      // Ensure users is an array
      if (!Array.isArray(users)) {
        users = users ? [users] : [];
      }

      // Extract and format user data properly
      const safeUsers = users
        .map(user => {
          const extracted = extractUserData(user);
          console.log('👤 Extracted user:', extracted?.email || 'no email');
          return extracted;
        })
        .filter(user => user !== null && user.email); // Filter out invalid entries

      console.log(`✅ Returning ${safeUsers.length} users`);

      res.json({
        success: true,
        data: safeUsers,
        count: safeUsers.length
      });

    } catch (error) {
      console.error("❌ Error fetching users:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  });

  // GET /:id - Get specific user (Changed from /users/:id to /:id)
  router.get("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`🔍 Fetching user with ID: ${id}`);
      
      const user = await storage.getUser(id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      const safeUser = extractUserData(user);
      delete safeUser.password; // Extra safety

      res.json({
        success: true,
        data: safeUser
      });
    } catch (error) {
      console.error("❌ Error fetching user:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  });

  // POST / - Create a new user (Changed from /users to /)
  router.post("/", async (req, res) => {
    try {
      const userData = req.body;
      console.log('📥 Received user creation request:', {
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        username: userData.username,
        businessId: userData.businessId,
        role: userData.role
      });

      // Validate user data
      const errors = validateUserData(userData);
      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors
        });
      }

      // Normalize role and status
      const normalizedRole = normalizeRole(userData.role);
      const normalizedStatus = "ACTIVE";

      // Check if business exists
      const business = await storage.getBusiness(userData.businessId);
      if (!business) {
        return res.status(400).json({
          success: false,
          message: "Business not found"
        });
      }

      // Check if username already exists
      const existingUser = await storage.getUserByUsername(userData.username);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "Username already exists"
        });
      }

      // Check if email already exists
      const existingEmail = await storage.getUserByEmail(userData.email);
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: "Email already exists"
        });
      }

      // Generate temporary password
      const temporaryPassword = generateTemporaryPassword();
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(temporaryPassword, saltRounds);

      const newUser = {
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        username: userData.username,
        phone: userData.phoneNumber,
        role: normalizedRole,
        businessId: userData.businessId,
        associatedBusinessId: userData.businessId,
        password: hashedPassword,
        status: normalizedStatus,
        passwordResetRequired: true,
        permissions: ["read", "write", "delete"],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      console.log('💾 Creating user with data:', {
        ...newUser,
        password: '[HIDDEN]'
      });

      const createdUser = await storage.createUser(newUser);

      // Send password setup email
      await sendPasswordSetupEmail({
        email: createdUser.email || newUser.email,
        firstName: createdUser.firstName || newUser.firstName,
        lastName: createdUser.lastName || newUser.lastName,
        username: createdUser.username || newUser.username
      }, temporaryPassword);

      const safeUser = extractUserData(createdUser);
      delete safeUser.password;

      console.log('✅ User created successfully:', safeUser.username);

      res.status(201).json({
        success: true,
        message: "User created successfully. Password setup email has been sent.",
        data: safeUser
      });

    } catch (error) {
      console.error("❌ Error creating user:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  });

  // PUT /:id - Update user (Changed from /users/:id to /:id)
  router.put("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const userData = req.body;

      console.log('📥 Received user update request for ID:', id);

      const existingUser = await storage.getUser(id);
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Validate required fields
      const errors = validateUserData(userData, true);
      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors
        });
      }

      // Normalize role
      const normalizedRole = normalizeRole(userData.role);

      // Check if business exists
      const business = await storage.getBusiness(userData.businessId);
      if (!business) {
        return res.status(400).json({
          success: false,
          message: "Business not found"
        });
      }

      // Check username uniqueness
      const userWithSameUsername = await storage.getUserByUsername(userData.username);
      if (userWithSameUsername && userWithSameUsername.id !== id) {
        return res.status(409).json({
          success: false,
          message: "Username already taken by another user"
        });
      }

      // Check email uniqueness
      const userWithSameEmail = await storage.getUserByEmail(userData.email);
      if (userWithSameEmail && userWithSameEmail.id !== id) {
        return res.status(409).json({
          success: false,
          message: "Email already taken by another user"
        });
      }

      const updateData = {
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        username: userData.username,
        phone: userData.phoneNumber,
        role: normalizedRole,
        businessId: userData.businessId,
        associatedBusinessId: userData.businessId,
        updatedAt: new Date()
      };

      const updatedUser = await storage.updateUser(id, updateData);
      const safeUser = extractUserData(updatedUser);
      delete safeUser.password;

      console.log('✅ User updated successfully:', safeUser.username);

      res.json({
        success: true,
        message: "User updated successfully",
        data: safeUser
      });

    } catch (error) {
      console.error("❌ Error updating user:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  });

  // DELETE /:id - Delete user (Changed from /users/:id to /:id)
  router.delete("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const existingUser = await storage.getUser(id);
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      await storage.updateUser(id, {
        status: "INACTIVE",
        updatedAt: new Date(),
        deletionReason: reason || "No reason provided"
      });

      console.log('✅ User deleted successfully:', existingUser.username || existingUser._doc?.username);

      res.json({
        success: true,
        message: "User deleted successfully"
      });

    } catch (error) {
      console.error("❌ Error deleting user:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  });

  // PUT /:id/status - Toggle user status (Changed from /users/:id/status to /:id/status)
  router.put("/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;

      if (!status || !["ACTIVE", "INACTIVE"].includes(status.toUpperCase())) {
        return res.status(400).json({
          success: false,
          message: "Valid status (ACTIVE/INACTIVE) is required"
        });
      }

      const existingUser = await storage.getUser(id);
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      const updateData = {
        status: status.toUpperCase(),
        updatedAt: new Date()
      };

      if (reason) {
        updateData.statusChangeReason = reason;
      }

      const updatedUser = await storage.updateUser(id, updateData);
      const safeUser = extractUserData(updatedUser);
      delete safeUser.password;

      console.log('✅ User status updated:', safeUser.username, 'to', status);

      res.json({
        success: true,
        message: `User ${status.toUpperCase() === "ACTIVE" ? "enabled" : "disabled"} successfully`,
        data: safeUser
      });

    } catch (error) {
      console.error("❌ Error updating user status:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  });

  // GET /business/:businessId - Get users by business ID
  router.get("/business/:businessId", async (req, res) => {
    try {
      const { businessId } = req.params;

      const business = await storage.getBusiness(businessId);
      if (!business) {
        return res.status(404).json({
          success: false,
          message: "Business not found"
        });
      }

      const users = await storage.getUsersByBusinessId(businessId);
      const safeUsers = users.map(user => {
        const extracted = extractUserData(user);
        delete extracted.password;
        return extracted;
      });

      res.json({
        success: true,
        data: safeUsers
      });
    } catch (error) {
      console.error("Error fetching business users:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  });

  // POST /:id/reset-password - Trigger password reset
  router.post("/:id/reset-password", async (req, res) => {
    try {
      const { id } = req.params;

      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      const temporaryPassword = generateTemporaryPassword();
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(temporaryPassword, saltRounds);

      await storage.updateUser(id, {
        password: hashedPassword,
        passwordResetRequired: true,
        updatedAt: new Date()
      });

      const userData = extractUserData(user);
      await sendPasswordSetupEmail(userData, temporaryPassword);

      console.log('✅ Password reset email sent to:', userData.email);

      res.json({
        success: true,
        message: "Password reset email sent successfully"
      });

    } catch (error) {
      console.error("❌ Error sending password reset:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  });

  return router;
}