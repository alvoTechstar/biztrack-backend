// src/storage/mongoStorage.js
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

// Define Mongoose schemas
const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phone: { type: String, required: true },
  role: {
    type: String,
    enum: [
      "Super_Admin", "Biztrack_ADMIN",
      "Hotel_Admin", "Hotel_Cashier", "Hotel_Waiter",
      "Kiosk_Admin", "Kiosk_Shopkeeper",
      "Hospital_Admin", "Doctor", "Nurse", "Lab_Technician", "Receptionist", "Pharmacist",
    ],
    default: "Staff"
  },
  businessName: { type: String },
  associatedBusinessId: { type: String },
  institutionId: { type: String },
  institutionName: { type: String },
  status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
  permissions: { type: Array, default: ["read", "write", "delete"] },
  lastLogin: { type: String, default: "Never" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const businessSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  businessId: { type: Number, required: true, unique: true },
  registrationNumber: { type: String, required: true, unique: true },
  businessName: { type: String, required: true, unique: true },
  owner: { type: String, required: true },
  businessType: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, default: "" },
  website: { type: String, default: "" },
  description: { type: String, default: "" },
  logoUrl: { type: String, default: "" },
  primaryColor: { type: String, default: "#000000" },
  status: { type: String, default: "active" },
  paymentConfig: {
    paymentType: { type: String, enum: ['TILL', 'PAYBILL', 'POCHI'], default: 'TILL' },
    tillNumber: { type: String, default: null },
    paybillNumber: { type: String, default: null },
    accountNumber: { type: String, default: null },
    pochiNumber: { type: String, default: null }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// ENHANCED OTP Schema
const otpSchema = new mongoose.Schema({
  id: { 
    type: String, 
    required: true, 
    unique: true, 
    default: () => randomUUID() 
  },
  email: { 
    type: String, 
    required: true, 
    index: true 
  },
  originalOtp: {  // Store original OTP
    type: String, 
    required: true 
  },
  maskedOtp: {  // Store masked version
    type: String,
    default: null
  },
  type: { 
    type: String, 
    required: true, 
    enum: ["login", "reset", "verification"],
    default: "login" 
  },
  userId: { 
    type: String, 
    index: true 
  },
  expiresAt: { 
    type: Date, 
    required: true,
    index: true 
  },
  status: {  // Changed from 'used' to 'status'
    type: String,
    enum: ["pending", "consumed", "expired", "revoked"],
    default: "pending"
  },
  consumedAt: {  // Changed from 'usedAt'
    type: Date 
  },
  attempts: { 
    type: Number, 
    default: 0 
  },
  ipAddress: {  // Track IP for security
    type: String
  },
  userAgent: {  // Track device info
    type: String
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Add TTL index for auto-deletion of expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Update timestamp on save
otpSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Create Mongoose models
const User = mongoose.model('User', userSchema);
const Business = mongoose.model('Business', businessSchema);
const OTP = mongoose.model('OTP', otpSchema);

export class MongoStorage {
  constructor() {
    this.User = User;
    this.Business = Business;
    this.OTP = OTP;
  }

  async initialize() {
    await this.createDefaultSetup();
    await this.cleanupExpiredOTPs();
    console.log("✅ MongoStorage initialized with enhanced OTP handling");
  }

  async createDefaultSetup() {
    try {
      console.log("🔧 Checking for default business and admin...");

      const existingBusiness = await this.Business.findOne({ businessName: "BizTrack Application" });
      let business;

      if (existingBusiness) {
        console.log('✅ Default business already exists');
        business = existingBusiness;
      } else {
        const defaultBusiness = new this.Business({
          id: randomUUID(),
          businessId: 0,
          registrationNumber: "BRN-SYSTEM-001",
          businessName: "BizTrack Application",
          owner: "admin@biztrack.com",
          businessType: "System",
          email: "system@biztrack.com",
          phone: "0711000000",
          address: "Nairobi, Kenya",
          website: "https://biztrack.com",
          description: "Default BizTrack System Business",
          logoUrl: "https://stage.biztrack.co.za/",
          primaryColor: "#4F46E5",
          status: "active",
        });

        await defaultBusiness.save();
        business = defaultBusiness;
        console.log('✅ Default business created successfully!');
      }

      const existingAdmin = await this.User.findOne({ email: "admin@biztrack.com" });
      if (!existingAdmin) {
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash("Admin123!", saltRounds);

        const defaultAdmin = new this.User({
          id: randomUUID(),
          username: "admin@biztrack.com",
          email: "admin@biztrack.com",
          password: hashedPassword,
          firstName: "Super",
          lastName: "Admin",
          phone: "0711000001",
          role: "Super_Admin",
          businessName: "BizTrack Application",
          associatedBusinessId: business.id,
          institutionId: business.id,
          institutionName: "BizTrack Application",
          status: "ACTIVE",
          permissions: ["read", "write", "delete", "admin", "super_admin"],
          lastLogin: "Never",
        });

        await defaultAdmin.save();
        console.log('✅ Default super admin user created successfully!');
      }

      console.log('\n📋 DEFAULT LOGIN CREDENTIALS:');
      console.log('─────────────────────────────');
      console.log('Email:    admin@biztrack.com');
      console.log('Password: Admin123!');
      console.log('Role:     Super_Admin');
      console.log('Business: BizTrack Application');
      console.log('─────────────────────────────\n');

    } catch (error) {
      console.error('❌ Error creating default setup:', error);
    }
  }

  // ==================== ENHANCED OTP METHODS ====================

  // Helper method to mask OTP (shows only first and last digit)
  maskOTP(otp) {
    if (!otp || otp.length !== 6) return "******";
    return `${otp.charAt(0)}****${otp.charAt(5)}`;
  }

  // Helper method to fully mask consumed OTP
  fullyMaskOTP(otp) {
    return "••••••";
  }

  async createOTP(email, otp, type, userId = null, metadata = {}) {
    try {
      console.log(`\n📝 === CREATING OTP ===`);
      console.log(`   Email: ${email}`);
      console.log(`   OTP: ${otp}`);
      console.log(`   Type: ${type}`);
      console.log(`   User ID: ${userId}`);
      
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      // Revoke all previous pending OTPs for this email and type
      const revokeResult = await this.OTP.updateMany(
        { 
          email, 
          type, 
          status: "pending"
        },
        { 
          status: "revoked",
          updatedAt: new Date(),
          $set: { reason: "superseded_by_new_otp" }
        }
      );
      
      if (revokeResult.modifiedCount > 0) {
        console.log(`   Revoked ${revokeResult.modifiedCount} previous pending OTPs`);
      }

      // Create new OTP with original value and masked version
      const newOTP = new this.OTP({
        id: randomUUID(),
        email,
        originalOtp: otp,
        maskedOtp: this.maskOTP(otp), // Store masked version
        type,
        userId,
        expiresAt,
        status: "pending",
        ...metadata,
        createdAt: new Date()
      });

      const savedOTP = await newOTP.save();
      
      console.log(`✅ OTP CREATED SUCCESSFULLY`);
      console.log(`   OTP ID: ${savedOTP.id}`);
      console.log(`   Status: ${savedOTP.status}`);
      console.log(`   Masked: ${savedOTP.maskedOtp}`);
      console.log(`   Expires: ${savedOTP.expiresAt.toISOString()}`);
      
      return {
        id: savedOTP.id,
        otp: savedOTP.originalOtp, // Return original for sending
        maskedOtp: savedOTP.maskedOtp
      };
      
    } catch (error) {
      console.error(`❌ ERROR CREATING OTP: ${error.message}`);
      throw error;
    }
  }

  async getValidOTP(email, otp, type = null, metadata = {}) {
    try {
      console.log(`\n🔍 === FINDING VALID OTP ===`);
      console.log(`   Email: ${email}`);
      console.log(`   OTP provided: ${otp}`);
      
      const now = new Date();
      const query = {
        email: email.trim().toLowerCase(),
        originalOtp: otp, // Match against original OTP
        expiresAt: { $gt: now },
        status: "pending"
      };

      if (type) {
        query.type = type;
      }

      console.log(`   Query:`, JSON.stringify(query));
      
      const foundOTP = await this.OTP.findOne(query).sort({ createdAt: -1 });
      
      if (foundOTP) {
        console.log(`✅ VALID PENDING OTP FOUND`);
        console.log(`   OTP ID: ${foundOTP.id}`);
        console.log(`   Status: ${foundOTP.status}`);
        console.log(`   Expires: ${foundOTP.expiresAt.toISOString()}`);
        
        // Increment attempts counter
        foundOTP.attempts += 1;
        
        // Update metadata if provided
        if (metadata.ipAddress) {
          foundOTP.ipAddress = metadata.ipAddress;
        }
        if (metadata.userAgent) {
          foundOTP.userAgent = metadata.userAgent;
        }
        
        await foundOTP.save();
        console.log(`   Updated attempts to: ${foundOTP.attempts}`);
        
        return foundOTP;
      } else {
        console.log(`❌ NO VALID PENDING OTP FOUND`);
        
        // Check what OTPs exist for debugging
        const debugQuery = {
          email: email.trim().toLowerCase(),
          originalOtp: otp
        };
        
        const allMatchingOTPs = await this.OTP.find(debugQuery).sort({ createdAt: -1 });
        
        if (allMatchingOTPs.length === 0) {
          console.log(`   No OTPs found with this email and code`);
        } else {
          console.log(`   Found ${allMatchingOTPs.length} matching OTPs with different statuses:`);
          allMatchingOTPs.forEach((otpDoc, index) => {
            const isExpired = otpDoc.expiresAt < now;
            console.log(`   ${index + 1}. Status: ${otpDoc.status}, ` +
                      `Expired: ${isExpired}, ` +
                      `Created: ${otpDoc.createdAt.toISOString()}, ` +
                      `Expires: ${otpDoc.expiresAt.toISOString()}`);
          });
        }
        
        return null;
      }
    } catch (error) {
      console.error(`❌ ERROR FINDING OTP: ${error.message}`);
      return null;
    }
  }

  async consumeOTP(email, otp = null, metadata = {}) {
    try {
      console.log(`\n🔄 === CONSUMING OTP ===`);
      console.log(`   Email: ${email}`);
      console.log(`   OTP: ${otp || 'all pending for this email'}`);
      
      const query = { 
        email: email.trim().toLowerCase(), 
        status: "pending"
      };
      
      if (otp) {
        query.originalOtp = otp;
      }

      console.log(`   Query:`, JSON.stringify(query));
      
      const updateData = {
        status: "consumed",
        consumedAt: new Date(),
        maskedOtp: this.fullyMaskOTP(otp), // Fully mask the OTP
        updatedAt: new Date(),
        $set: {
          ...metadata,
          consumptionReason: "verified_successfully"
        }
      };

      const result = await this.OTP.updateMany(query, updateData);
      
      console.log(`✅ CONSUMED ${result.modifiedCount} OTP(S)`);
      
      // Verify the update
      if (otp) {
        const updatedOTP = await this.OTP.findOne({ email, originalOtp: otp });
        if (updatedOTP) {
          console.log(`   Verification - OTP ${this.maskOTP(otp)}:`);
          console.log(`     Status: ${updatedOTP.status}`);
          console.log(`     Consumed At: ${updatedOTP.consumedAt?.toISOString()}`);
          console.log(`     Masked Display: ${updatedOTP.maskedOtp}`);
        }
      }
      
      return result.modifiedCount > 0;
      
    } catch (error) {
      console.error(`❌ ERROR CONSUMING OTP: ${error.message}`);
      return false;
    }
  }

  // Backward compatibility - keep old method but use new one internally
  async markOTPAsUsed(email, otp = null) {
    return this.consumeOTP(email, otp, { 
      compatibilityMode: "markOTPAsUsed" 
    });
  }

  async getRecentOTPAttempts(email, minutes = 10) {
    try {
      const timeLimit = new Date(Date.now() - minutes * 60 * 1000);
      const count = await this.OTP.countDocuments({
        email: email.trim().toLowerCase(),
        createdAt: { $gt: timeLimit },
        status: "pending"
      });
      
      console.log(`📊 Recent OTP attempts for ${email}: ${count} in last ${minutes} minutes`);
      return count;
    } catch (error) {
      console.error('Error getting OTP attempts:', error);
      return 0;
    }
  }

  async getOTPStatus(email, otp = null) {
    try {
      const query = { email: email.trim().toLowerCase() };
      if (otp) {
        query.originalOtp = otp;
      }

      const otpDoc = await this.OTP.findOne(query).sort({ createdAt: -1 });
      
      if (!otpDoc) {
        return {
          exists: false,
          status: "not_found",
          message: "No OTP found for this email"
        };
      }

      const now = new Date();
      const isExpired = otpDoc.expiresAt < now;
      
      // Determine actual status
      let actualStatus = otpDoc.status;
      if (actualStatus === "pending" && isExpired) {
        actualStatus = "expired";
      }

      return {
        exists: true,
        id: otpDoc.id,
        email: otpDoc.email,
        originalOtp: actualStatus === "consumed" || actualStatus === "revoked" 
          ? this.fullyMaskOTP(otpDoc.originalOtp) 
          : this.maskOTP(otpDoc.originalOtp),
        maskedOtp: otpDoc.maskedOtp,
        type: otpDoc.type,
        status: actualStatus,
        isExpired,
        attempts: otpDoc.attempts,
        createdAt: otpDoc.createdAt,
        expiresAt: otpDoc.expiresAt,
        consumedAt: otpDoc.consumedAt,
        canBeUsed: actualStatus === "pending" && !isExpired
      };
      
    } catch (error) {
      console.error(`❌ ERROR GETTING OTP STATUS: ${error.message}`);
      return {
        exists: false,
        status: "error",
        message: error.message
      };
    }
  }

  async cleanupExpiredOTPs() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Delete OTPs older than 30 days (regardless of status)
      const deleteResult = await this.OTP.deleteMany({
        createdAt: { $lt: thirtyDaysAgo }
      });
      
      if (deleteResult.deletedCount > 0) {
        console.log(`🧹 CLEANED UP ${deleteResult.deletedCount} OLD OTP(S)`);
      }
      
      return deleteResult.deletedCount;
      
    } catch (error) {
      console.error('Error cleaning up OTPs:', error);
      return 0;
    }
  }

  // ==================== DEBUG METHODS ====================

  async debugOTPs(email = null) {
    try {
      console.log("\n" + "=".repeat(80));
      console.log("🔍 OTP DATABASE DEBUG - ENHANCED SYSTEM");
      console.log("=".repeat(80));
      
      const query = email ? { email: email.trim().toLowerCase() } : {};
      const allOTPs = await this.OTP.find(query).sort({ createdAt: -1 }).limit(20);
      const totalCount = await this.OTP.countDocuments(query);
      
      console.log(`\n📊 STATISTICS:`);
      console.log(`   Total OTPs in database: ${totalCount}`);
      console.log(`   Showing last: ${allOTPs.length}`);
      
      if (allOTPs.length > 0) {
        console.log("\n📋 OTP DETAILS:");
        console.log("-".repeat(120));
        console.log(
          "Status".padEnd(10) + " | " +
          "Email".padEnd(25) + " | " +
          "OTP Display".padEnd(12) + " | " +
          "Type".padEnd(10) + " | " +
          "Attempts".padEnd(8) + " | " +
          "Created".padEnd(20) + " | " +
          "Expires".padEnd(20) + " | " +
          "Consumed"
        );
        console.log("-".repeat(120));
        
        allOTPs.forEach(otp => {
          const now = new Date();
          const isExpired = otp.expiresAt < now;
          const statusIcon = {
            "pending": isExpired ? "⏰" : "⏳",
            "consumed": "✅",
            "revoked": "🚫",
            "expired": "⏰"
          }[otp.status] || "❓";
          
          const displayOtp = otp.maskedOtp || this.maskOTP(otp.originalOtp);
          
          console.log(
            (statusIcon + " " + otp.status).padEnd(10) + " | " +
            otp.email.substring(0, 24).padEnd(25) + " | " +
            displayOtp.padEnd(12) + " | " +
            otp.type.padEnd(10) + " | " +
            otp.attempts.toString().padEnd(8) + " | " +
            otp.createdAt.toLocaleString().padEnd(20) + " | " +
            otp.expiresAt.toLocaleString().padEnd(20) + " | " +
            (otp.consumedAt ? otp.consumedAt.toLocaleString() : "N/A")
          );
        });
        
        console.log("-".repeat(120));
        
        // Count by status
        const statusCounts = await this.OTP.aggregate([
          { $match: query },
          { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);
        
        console.log(`\n📈 STATUS BREAKDOWN:`);
        statusCounts.forEach(stat => {
          console.log(`   ${stat._id}: ${stat.count}`);
        });
      } else {
        console.log("\n📭 No OTPs found in database");
      }
      
      console.log("\n" + "=".repeat(80));
      
    } catch (error) {
      console.error('Error debugging OTPs:', error);
    }
  }

  // ==================== USER METHODS ====================
  // KEEP ALL YOUR EXISTING USER METHODS EXACTLY AS THEY ARE
  
  async getUserByEmail(email) {
    try {
      const user = await this.User.findOne({ email: email.trim().toLowerCase() });
      return user ? user.toObject() : undefined;
    } catch (error) {
      console.error('Error finding user by email:', error);
      throw error;
    }
  }

  async getUser(id) {
    try {
      let user = await this.User.findOne({ id });
      if (!user) {
        user = await this.User.findById(id);
      }
      return user ? user.toObject() : undefined;
    } catch (error) {
      console.error('Error getting user:', error);
      return undefined;
    }
  }

  async getUserByUsername(username) {
    try {
      const user = await this.User.findOne({ username });
      return user ? user.toObject() : undefined;
    } catch (error) {
      console.error('Error finding user by username:', error);
      throw error;
    }
  }

  async createUser(userData) {
    try {
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(userData.password, saltRounds);

      const newUser = new this.User({
        ...userData,
        id: randomUUID(),
        password: hashedPassword,
      });

      await newUser.save();
      return newUser.toObject();
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async updateUserPassword(userId, newPassword) {
    try {
      let user = await this.User.findOne({ id: userId });
      if (!user) {
        user = await this.User.findById(userId);
      }

      if (!user) {
        console.log("❌ User not found with ID:", userId);
        return undefined;
      }

      user.password = newPassword;
      user.updatedAt = new Date();

      const result = await user.save();
      console.log("✅ Password updated successfully for:", user.email);

      return result.toObject();
    } catch (error) {
      console.error('❌ Error updating user password:', error);
      throw error;
    }
  }

  async updateUser(id, updateData) {
    try {
      const dataToUpdate = { ...updateData };
      delete dataToUpdate.password;

      const result = await this.User.findOneAndUpdate(
        { id },
        { ...dataToUpdate, updatedAt: new Date() },
        { new: true }
      );
      return result ? result.toObject() : undefined;
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  async deleteUser(id) {
    try {
      const result = await this.User.deleteOne({ id });
      return result.deletedCount > 0;
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  }

  async getAllUsers() {
    try {
      const users = await this.User.find();
      return users.map(user => user.toObject());
    } catch (error) {
      console.error('Error getting all users:', error);
      throw error;
    }
  }

  async updateUserLastLogin(userId) {
    try {
      const result = await this.User.findOneAndUpdate(
        { id: userId },
        {
          lastLogin: new Date().toISOString(),
          updatedAt: new Date()
        },
        { new: true }
      );
      return result ? result.toObject() : undefined;
    } catch (error) {
      console.error('Error updating user last login:', error);
      throw error;
    }
  }

  // ==================== BUSINESS METHODS ====================

  async getBusiness(identifier) {
    try {
      let business = await this.Business.findOne({ id: identifier });
      if (business) {
        return business.toObject();
      }

      const businessIdNum = parseInt(identifier, 10);
      if (!isNaN(businessIdNum)) {
        business = await this.Business.findOne({ businessId: businessIdNum });
        if (business) {
          return business.toObject();
        }
      }

      business = await this.Business.findOne({ businessId: identifier });
      if (business) {
        return business.toObject();
      }

      console.log('❌ Business not found with identifier:', identifier);
      return undefined;
    } catch (error) {
      console.error('❌ Error in getBusiness:', error);
      return undefined;
    }
  }

  async generateBusinessId() {
    try {
      const highestBusiness = await this.Business.findOne(
        { businessId: { $ne: 0 } },
        { businessId: 1 },
        { sort: { businessId: -1 } }
      );

      if (!highestBusiness) {
        return 1;
      }

      return highestBusiness.businessId + 1;
    } catch (error) {
      console.error('Error generating business ID:', error);
      const count = await this.Business.countDocuments({ businessId: { $ne: 0 } });
      return count + 1;
    }
  }

  async createBusiness(businessData) {
    const businessId = await this.generateBusinessId();

    const newBusiness = new this.Business({
      ...businessData,
      id: randomUUID(),
      businessId,
    });

    await newBusiness.save();
    return newBusiness.toObject();
  }

  async getBusinessByRegistrationNumber(regNumber) {
    const business = await this.Business.findOne({ registrationNumber: regNumber });
    return business ? business.toObject() : undefined;
  }

  async getBusinessByName(name) {
    const business = await this.Business.findOne({ businessName: name });
    return business ? business.toObject() : undefined;
  }

  async getBusinesses() {
    const businesses = await this.Business.find().sort({ businessId: 1 });
    return businesses.map(business => business.toObject());
  }

  async updateBusiness(id, updateData) {
    const dataToUpdate = { ...updateData };
    delete dataToUpdate.registrationNumber;
    delete dataToUpdate.owner;
    delete dataToUpdate.logoFile;

    const result = await this.Business.findOneAndUpdate(
      { id },
      { ...dataToUpdate, updatedAt: new Date() },
      { new: true }
    );
    return result ? result.toObject() : undefined;
  }

  async deleteBusiness(id) {
    const result = await this.Business.deleteOne({ id });
    return result.deletedCount > 0;
  }

  async getBusinessUsers(businessId) {
    const users = await this.User.find({ associatedBusinessId: businessId.toString() });
    return users.map(user => user.toObject());
  }

  async getBusinessByBusinessId(businessId) {
    try {
      const numericId = Number(businessId);
      if (isNaN(numericId)) {
        return undefined;
      }

      const business = await this.Business.findOne({ businessId: numericId });
      return business ? business.toObject() : undefined;
    } catch (error) {
      console.error('❌ Error in getBusinessByBusinessId:', error);
      return undefined;
    }
  }

  async getBusinessByIdentifier(identifier) {
    const businessIdNum = parseInt(identifier, 10);
    if (!isNaN(businessIdNum)) {
      const businessByNumericId = await this.Business.findOne({ businessId: businessIdNum });
      if (businessByNumericId) return businessByNumericId.toObject();
    }
    const businessByUUID = await this.Business.findOne({ id: identifier });
    if (businessByUUID) return businessByUUID.toObject();
    const businessByReg = await this.Business.findOne({ registrationNumber: identifier });
    if (businessByReg) return businessByReg.toObject();
    const businessByName = await this.Business.findOne({ businessName: identifier });
    if (businessByName) return businessByName.toObject();

    return undefined;
  }

  // ==================== DEBUG METHODS ====================

  async debugOTPs(email = null) {
    try {
      const query = email ? { email: email.trim().toLowerCase() } : {};
      const allOTPs = await this.OTP.find(query).sort({ createdAt: -1 }).limit(50);
      const totalCount = await this.OTP.countDocuments(query);
      
      console.log(`\n📊 OTP Statistics:`);
      console.log(`   Total OTPs: ${totalCount}`);
      console.log(`   Showing: ${allOTPs.length} most recent`);
      
      if (allOTPs.length > 0) {
        console.log("\n📋 OTP DETAILS:");
        allOTPs.forEach(otp => {
          const now = new Date();
          const isExpired = otp.expiresAt < now;
          const status = otp.used ? 'USED' : (isExpired ? 'EXPIRED' : 'ACTIVE');
          const statusColor = otp.used ? '✓' : (isExpired ? '✗' : '●');
          
          console.log(
            `   ${otp.id.substring(0, 8)}... | ` +
            `${otp.email} | ` +
            `${otp.otp} | ` +
            `${otp.type} | ` +
            `${statusColor} | ` +
            `${otp.createdAt.toISOString()}`
          );
        });
      }
      
    } catch (error) {
      console.error('Error debugging OTPs:', error);
    }
  }
}