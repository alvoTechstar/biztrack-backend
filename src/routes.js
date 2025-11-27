import { createServer } from "http";
// import { storage } from "./storage.js"; // Remove this import
import { insertContactMessageSchema, insertGivingRecordSchema } from "./schema.js";
import { z } from "zod";
import { mpesaService } from './mpesaService.js';
import { formatPhoneNumber, generateMpesaPassword, getTimestamp, isValidPhoneNumber, displayPhoneNumber } from "./utils.js";
import BusinessRoutes from "./routes/BusinessRoutes.js";
import UserManagementRoutes from "./routes/UsermanagementRoutes.js";
import AuthRoutes from "./routes/AuthRoutes.js";

/**
 * Registers all API routes for the application.
 * @param {import("express").Express} app The Express app instance.
 * @param {import("./storage.js").IStorage} storage The storage instance.
 * @returns {Promise<import("http").Server>} The HTTP server instance.
 */
export async function registerRoutes(app, storage) { // Accept storage as an argument
  // Mount the modular routers
  app.use("/api/businesses", BusinessRoutes(storage));
  app.use("/api/users", UserManagementRoutes(storage));
  app.use("/api/auth", AuthRoutes(storage));

  // Blog routes (unchanged)
  app.get("/api/blog/posts", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
      const posts = await storage.getBlogPosts(limit);
      res.json(posts);
    } catch (error) {
      console.error('Error fetching blog posts:', error);
      res.status(500).json({ message: "Failed to fetch blog posts" });
    }
  });

  app.get("/api/blog/posts/:id", async (req, res) => {
    try {
      const post = await storage.getBlogPost(req.params.id);
      if (!post) {
        return res.status(404).json({ message: "Blog post not found" });
      }
      res.json(post);
    } catch (error) {
      console.error('Error fetching blog post:', error);
      res.status(500).json({ message: "Failed to fetch blog post" });
    }
  });

  app.get("/api/blog/categories/:category", async (req, res) => {
    try {
      const posts = await storage.getBlogPostsByCategory(req.params.category);
      res.json(posts);
    } catch (error) {
      console.error('Error fetching blog posts by category:', error);
      res.status(500).json({ message: "Failed to fetch blog posts by category" });
    }
  });

  // Contact routes
  app.post("/api/contact", async (req, res) => {
    try {
      const validatedData = insertContactMessageSchema.parse(req.body);
      const message = await storage.createContactMessage(validatedData);
      res.status(201).json({ message: "Message sent successfully", id: message.id });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid form data", errors: error.errors });
      } else {
        console.error('Error creating contact message:', error);
        res.status(500).json({ message: "Failed to send message" });
      }
    }
  });

  app.get("/api/contact/messages", async (req, res) => {
    try {
      const messages = await storage.getContactMessages();
      res.json(messages);
    } catch (error) {
      console.error('Error fetching contact messages:', error);
      res.status(500).json({ message: "Failed to fetch contact messages" });
    }
  });

  // Giving routes
  app.post("/api/giving", async (req, res) => {
    let record;
    try {
      console.log('Received giving request:', req.body); // Debug log

      const validatedData = insertGivingRecordSchema.parse(req.body);

      // Check if phoneNumber field exists and has value
      if (!validatedData.phoneNumber || validatedData.phoneNumber.trim() === '') {
        return res.status(400).json({
          message: "Phone number is required",
          field: "phoneNumber",
          received: validatedData.phoneNumber || 'undefined'
        });
      }

      // Validate phone number format
      if (!isValidPhoneNumber(validatedData.phoneNumber)) {
        return res.status(400).json({
          message: "Invalid phone number format. Please use a valid Kenyan phone number (e.g., 0712345678 or 254712345678).",
          field: "phoneNumber",
          received: validatedData.phoneNumber,
          examples: ["0712345678", "254712345678", "712345678"]
        });
      }

      // Format phone number (this will throw if still invalid)
      let formattedPhoneNumber;
      try {
        formattedPhoneNumber = formatPhoneNumber(validatedData.phoneNumber);
      } catch (formatError) {
        return res.status(400).json({
          message: "Failed to format phone number",
          error: formatError.message,
          received: validatedData.phoneNumber
        });
      }

      console.log(`Original phone: ${validatedData.phoneNumber}, Formatted: ${formattedPhoneNumber}`);

      // Create the giving record
      record = await storage.createGivingRecord(validatedData);

      // Amount is now guaranteed to be a valid positive number due to schema validation
      const amount = validatedData.amount;
      const businessShortCode = process.env.MPESA_PAYBILL_NUMBER;
      const callbackUrl = `${process.env.YOUR_APP_URL}/api/mpesa/callback`;
      const transactionDesc = `Donation to ${validatedData.organization || 'our cause'}`;
      const stkTransactionId = `GIV${Date.now()}${record.id.substring(0, 4)}`;

      console.log('Sending STK push with details:', {
        phone: formattedPhoneNumber,
        amount,
        businessShortCode,
        accountReference: record.id
      });

      // Pass arguments individually, not as a single object
      const mpesaResponse = await mpesaService.sendStkPush(
        formattedPhoneNumber,
        amount,
        record.id
      );

      // Check for successful response (M-Pesa uses "0" for success)
      if (mpesaResponse.ResponseCode === "0") {
        await storage.updateGivingRecordStatus(record.id, "initiated", stkTransactionId);
        res.status(201).json({
          message: "Giving record created. Please check your M-Pesa for a prompt.",
          id: record.id,
          transactionId: stkTransactionId,
          phone: displayPhoneNumber(validatedData.phoneNumber),
          instructions: "You will receive an M-Pesa prompt on your phone shortly. Approve the transaction.",
        });
      } else {
        console.error("M-Pesa STK Push initiation failed:", mpesaResponse);
        await storage.updateGivingRecordStatus(record.id, "failed", stkTransactionId);
        res.status(500).json({
          message: "Failed to initiate M-Pesa transaction. Please try again.",
          error: mpesaResponse.ResponseDescription || mpesaResponse.errorMessage || "Unknown M-Pesa error",
          requestId: mpesaResponse.requestId,
          responseCode: mpesaResponse.ResponseCode
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('Validation error:', error.errors);

        const phoneError = error.errors.find(err =>
          err.path.includes('phoneNumber') || err.path[0] === 'phoneNumber'
        );

        if (phoneError) {
          return res.status(400).json({
            message: "Phone number validation failed",
            error: phoneError.message,
            field: "phoneNumber",
            receivedData: req.body,
            allErrors: error.errors
          });
        }

        res.status(400).json({
          message: "Invalid form data",
          errors: error.errors,
          receivedData: req.body
        });
      } else {
        console.error('Error creating giving record:', error);
        if (record && record.id) {
          await storage.updateGivingRecordStatus(record.id, "failed");
        }
        res.status(500).json({
          message: "Failed to process giving",
          error: error.message
        });
      }
    }
  });

  app.post("/api/mpesa/callback", async (req, res) => {
    const mpesaCallbackData = req.body;
    console.log('M-Pesa callback received:', JSON.stringify(mpesaCallbackData, null, 2));

    try {
      const resultCode = mpesaCallbackData.Body.stkCallback.ResultCode;
      const resultDesc = mpesaCallbackData.Body.stkCallback.ResultDesc;
      const checkoutRequestID = mpesaCallbackData.Body.stkCallback.CheckoutRequestID;

      let accountReference = "";
      let mpesaReceiptNumber = "";

      // Extract details from callback metadata if available
      if (mpesaCallbackData.Body.stkCallback.CallbackMetadata &&
        mpesaCallbackData.Body.stkCallback.CallbackMetadata.Item) {
        const items = mpesaCallbackData.Body.stkCallback.CallbackMetadata.Item;

        const accountRefItem = items.find((item) => item.Name === 'AccountReference');
        if (accountRefItem) accountReference = accountRefItem.Value;

        const receiptItem = items.find((item) => item.Name === 'MpesaReceiptNumber');
        if (receiptItem) mpesaReceiptNumber = receiptItem.Value;
      }

      if (!accountReference) {
        console.error("M-Pesa callback received without account reference.");
        return res.status(400).json({ message: "Callback missing account reference." });
      }

      let newStatus = (resultCode === 0) ? 'completed' : 'failed';
      await storage.updateGivingRecordStatus(accountReference, newStatus, mpesaReceiptNumber);

      console.log(`Updated record ${accountReference} to status: ${newStatus}`);

      res.status(200).json({
        ResponseCode: "000000",
        ResponseDescription: "Callback received successfully",
        CheckoutRequestID: checkoutRequestID,
      });

    } catch (error) {
      console.error("Error processing M-Pesa callback:", error);
      res.status(500).json({
        ResponseCode: "000001",
        ResponseDescription: "Callback processing failed",
      });
    }
  });

  app.get("/api/giving/records", async (req, res) => {
    try {
      const records = await storage.getGivingRecords();
      res.json(records);
    } catch (error) {
      console.error('Error fetching giving records:', error);
      res.status(500).json({ message: "Failed to fetch giving records" });
    }
  });

  app.get("/api/giving/records/:id/status", async (req, res) => {
    try {
      const record = await storage.getGivingRecord(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Giving record not found" });
      }
      res.json({ status: record.status, transactionId: record.transactionId });
    } catch (error) {
      console.error('Error fetching giving status:', error);
      res.status(500).json({ message: "Failed to fetch giving status" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}