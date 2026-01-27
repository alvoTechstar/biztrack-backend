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
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Add OTP Schema
const otpSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, default: () => randomUUID() },
  email: { type: String, required: true, index: true },
  otp: { type: String, required: true },
  type: { 
    type: String, 
    required: true, 
    enum: ["login", "reset", "verification"],
    default: "login" 
  },
  userId: { type: String, index: true },
  expiresAt: { type: Date, required: true, index: true },
  used: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, index: true }
});

// Create indexes for better performance
otpSchema.index({ email: 1, type: 1, used: 1 });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-delete expired OTPs

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
    console.log("MongoStorage initialized with OTP collection");
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

  // === OTP METHODS ===

  async createOTP(email, otp, type, userId = null) {
    try {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      // Invalidate any existing OTPs for this email and type
      await this.OTP.updateMany(
        { email, type, used: false },
        { used: true }
      );

      const newOTP = new this.OTP({
        email,
        otp,
        type,
        userId,
        expiresAt
      });

      await newOTP.save();
      console.log(`✅ OTP created for ${email} (${type}): ${otp}`);
      return newOTP.id;
    } catch (error) {
      console.error('❌ Error creating OTP:', error);
      throw error;
    }
  }

  async getValidOTP(email, otp, type = null) {
    try {
      const now = new Date();
      const query = {
        email,
        otp,
        expiresAt: { $gt: now },
        used: false
      };

      if (type) {
        query.type = type;
      }

      const foundOTP = await this.OTP.findOne(query).sort({ createdAt: -1 });
      
      if (foundOTP) {
        // Increment attempts
        foundOTP.attempts += 1;
        await foundOTP.save();
      }

      return foundOTP ?? undefined;
    } catch (error) {
      console.error('❌ Error getting OTP:', error);
      return undefined;
    }
  }

  async markOTPAsUsed(email, otp = null) {
    try {
      const query = { email, used: false };
      if (otp) {
        query.otp = otp;
      }

      const result = await this.OTP.updateMany(
        query,
        { used: true }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      console.error('❌ Error marking OTP as used:', error);
      return false;
    }
  }

  async getRecentOTPAttempts(email, minutes = 10) {
    try {
      const timeLimit = new Date(Date.now() - minutes * 60 * 1000);
      const count = await this.OTP.countDocuments({
        email,
        createdAt: { $gt: timeLimit },
        used: false
      });
      return count;
    } catch (error) {
      console.error('❌ Error getting OTP attempts:', error);
      return 0;
    }
  }

  async cleanupExpiredOTPs() {
    try {
      const now = new Date();
      const result = await this.OTP.deleteMany({
        $or: [
          { expiresAt: { $lte: now } },
          { used: true }
        ]
      });
      
      if (result.deletedCount > 0) {
        console.log(`🧹 Cleaned up ${result.deletedCount} expired/used OTPs`);
      }
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up OTPs:', error);
      return 0;
    }
  }

  // === USER METHODS ===

  async getUser(id) {
    try {
      let user = await this.User.findOne({ id });
      if (!user) {
        user = await this.User.findById(id);
      }
      return user ?? undefined;
    } catch (error) {
      console.error('Error getting user:', error);
      return undefined;
    }
  }

  async getUserByEmail(email) {
    try {
      const user = await this.User.findOne({ email });
      return user ?? undefined;
    } catch (error) {
      console.error('Error finding user by email:', error);
      throw error;
    }
  }

  async getUserByUsername(username) {
    try {
      const user = await this.User.findOne({ username });
      return user ?? undefined;
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
      return newUser;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async updateUserPassword(userId, newPassword) {
    try {
      console.log("🔐 Updating password for user ID:", userId);

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

      return result;
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
      return result ?? undefined;
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
      return await this.User.find();
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
      return result ?? undefined;
    } catch (error) {
      console.error('Error updating user last login:', error);
      throw error;
    }
  }

  // === BUSINESS METHODS ===

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
    console.log("📝 Creating business with data:", businessData);

    const businessId = await this.generateBusinessId();
    console.log("🔢 Generated Business ID:", businessId);

    const newBusiness = new this.Business({
      ...businessData,
      id: randomUUID(),
      businessId,
    });

    await newBusiness.save();
    return newBusiness;
  }

  async getBusinessByRegistrationNumber(regNumber) {
    const business = await this.Business.findOne({ registrationNumber: regNumber });
    return business ?? undefined;
  }

  async getBusinessByName(name) {
    const business = await this.Business.findOne({ businessName: name });
    return business ?? undefined;
  }

  async getBusiness(identifier) {
    try {
      console.log('🔍 getBusiness called with:', identifier, typeof identifier);

      let business = await this.Business.findOne({ id: identifier });
      if (business) {
        console.log('✅ Found business by UUID');
        return business;
      }

      const businessIdNum = parseInt(identifier, 10);
      if (!isNaN(businessIdNum)) {
        business = await this.Business.findOne({ businessId: businessIdNum });
        if (business) {
          console.log('✅ Found business by numeric businessId');
          return business;
        }
      }

      business = await this.Business.findOne({ businessId: identifier });
      if (business) {
        console.log('✅ Found business by string businessId');
        return business;
      }

      console.log('❌ Business not found with identifier:', identifier);
      return undefined;
    } catch (error) {
      console.error('❌ Error in getBusiness:', error);
      return undefined;
    }
  }

  async getBusinessByBusinessId(businessId) {
    try {
      console.log('🔍 getBusinessByBusinessId called with:', businessId, typeof businessId);

      const numericId = Number(businessId);
      if (isNaN(numericId)) {
        console.log('❌ Not a valid number:', businessId);
        return undefined;
      }

      const business = await this.Business.findOne({ businessId: numericId });
      console.log('✅ Business found:', !!business);
      if (business) {
        console.log('Business details:', {
          id: business.id,
          businessId: business.businessId,
          businessName: business.businessName
        });
      }
      return business ?? undefined;
    } catch (error) {
      console.error('❌ Error in getBusinessByBusinessId:', error);
      return undefined;
    }
  }

  async getBusinesses() {
    return await this.Business.find().sort({ businessId: 1 });
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
    return result ?? undefined;
  }

  async deleteBusiness(id) {
    const result = await this.Business.deleteOne({ id });
    return result.deletedCount > 0;
  }

  async getBusinessUsers(businessId) {
    return await this.User.find({ associatedBusinessId: businessId.toString() });
  }

  async getBusinessByIdentifier(identifier) {
    const businessIdNum = parseInt(identifier, 10);
    if (!isNaN(businessIdNum)) {
      const businessByNumericId = await this.Business.findOne({ businessId: businessIdNum });
      if (businessByNumericId) return businessByNumericId;
    }
    const businessByUUID = await this.Business.findOne({ id: identifier });
    if (businessByUUID) return businessByUUID;
    const businessByReg = await this.Business.findOne({ registrationNumber: identifier });
    if (businessByReg) return businessByReg;
    const businessByName = await this.Business.findOne({ businessName: identifier });
    if (businessByName) return businessByName;

    return undefined;
  }
}