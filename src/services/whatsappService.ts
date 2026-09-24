import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import fs from "fs";
import path from "path";
import { AppDataSource } from "../config/db";
import { Token } from "../models/Token";
import { User } from "../models/User";
import { MaterialAccount } from "../models/materialaccount";
import { generateAndSendUserReportPDF } from "./whatappSendServices";

// ⭐ PRODUCTION FIX: Prevent Node.js server crashes from internal Puppeteer/WhatsApp errors
process.on("unhandledRejection", (reason: any, promise) => {
  const errorMsg = reason?.message || String(reason);
  if (
    errorMsg.includes("Execution context was destroyed") ||
    errorMsg.includes("Attempted to use detached Frame") ||
    errorMsg.includes("EBUSY") ||
    errorMsg.includes("Session closed") ||
    errorMsg.includes("Target closed") ||
    errorMsg.includes("The browser is already running") // ⭐ YAHAN NAYA ERROR FIX KIYA HAI
  ) {
    console.log("⚠️ Suppressed internal Puppeteer error:", errorMsg.split('\n')[0]);
  } else {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
  }
});

export const sessionStatus = new Map<string, string>(); 
export const qrCodeData = new Map<string, string>(); 
const activeClients = new Map<string, Client>(); 

const tokenRepo = AppDataSource.getRepository(Token);
const userRepo = AppDataSource.getRepository(User);
const accountRepo = AppDataSource.getRepository(MaterialAccount);

const registerMessageListener = (client: Client) => {
  client.on("message", async (msg) => {
    console.log("🚨 MESSAGE EVENT TRIGGERED:", msg.from, "Body:", msg.body);
    try {
      let senderPhone = "";
      
      const rawChatId = msg.from;
      if (rawChatId.includes("156126406566128") || rawChatId.includes("917622855036")) {
        senderPhone = "7622855036"; 
      } else if (msg.from.includes("@lid")) {
        try {
          const contact = await msg.getContact();
          if (contact && contact.number) {
            senderPhone = contact.number;
          }
        } catch (err) {
          console.error("Failed to get contact from LID:", err);
        }
      }

      if (!senderPhone) {
        senderPhone = msg.from.replace("@c.us", "").replace("@s.whatsapp.net", "").replace("+", "");
      }

      const messageBody = msg.body?.trim().toLowerCase();

      console.log(`📩 Resolved Sender Phone: ${senderPhone} | Message: "${messageBody}"`);

      if (senderPhone && (messageBody === "hi" || messageBody === "hello" || messageBody === "report")) {
        
        const matchingToken = await tokenRepo.createQueryBuilder("token")
          .leftJoinAndSelect("token.user", "user")
          .leftJoinAndSelect("user.creator", "creator")
          .where("token.customerPhone LIKE :phone OR token.customerPhone LIKE :plusPhone", {
            phone: `%${senderPhone}%`,
            plusPhone: `%+${senderPhone}%`
          })
          .orderBy("token.id", "DESC")
          .getOne();

        if (matchingToken) {
          const customerName = matchingToken.customerName;
          const assignedUser = matchingToken.user; 

          const customerTokens = await tokenRepo.createQueryBuilder("token")
            .where("token.customerPhone LIKE :phone OR token.customerPhone LIKE :plusPhone", {
              phone: `%${senderPhone}%`,
              plusPhone: `%+${senderPhone}%`
            })
            .orderBy("token.id", "DESC")
            .getMany();

          const accounts = await accountRepo.find({
            where: { user: { id: assignedUser.id } },
          });

          const adminUser = assignedUser.role === "user" ? assignedUser.creator : assignedUser;
          const targetAdminId = adminUser?.id || assignedUser.id;

          const reportUser = {
            id: assignedUser.id,
            name: customerName,
            email: assignedUser.email || "customer@bricks.com",
          };

          await generateAndSendUserReportPDF(reportUser as any, customerTokens, accounts, {
            adminId: targetAdminId,
            phone: senderPhone,
          });

          console.log(`✅ Auto PDF token report sent to Customer: ${customerName} (${senderPhone})`);
        } else {
          const user = await userRepo.createQueryBuilder("user")
            .leftJoinAndSelect("user.creator", "creator")
            .where("user.phone LIKE :phone OR user.phone LIKE :plusPhone", {
              phone: `%${senderPhone}%`,
              plusPhone: `%+${senderPhone}%`
            })
            .getOne();

          if (user) {
            const tokens = await tokenRepo.find({
              where: { user: { id: user.id } },
              order: { id: "DESC" },
            });

            const accounts = await accountRepo.find({
              where: { user: { id: user.id } },
            });

            const adminUser = user.role === "user" ? user.creator : user;
            const targetAdminId = adminUser?.id || user.id;

            await generateAndSendUserReportPDF(user, tokens, accounts, {
              adminId: targetAdminId,
              phone: senderPhone,
            });

            console.log(`✅ Auto PDF report sent to Dealer: ${user.name} (${senderPhone})`);
          } else {
            console.log(`❌ Phone number ${senderPhone} not found in database.`);
          }
        }
      }
    } catch (error) {
      console.error("Webhook/Message Event Error:", error);
    }
  });
};

export const initWhatsAppOnLogin = async (adminId: number) => {
  const sessionId = `admin_${adminId}`;

  if (activeClients.has(sessionId)) {
    console.log(`✅ WhatsApp already running for Admin ID: ${adminId}`);
    return activeClients.get(sessionId);
  }

  console.log(`🔄 Starting WhatsApp auto-connect for Admin ID: ${adminId}...`);
  sessionStatus.set(String(adminId), "INITIALIZING");
  
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId }),
    puppeteer: {
      headless: true, 
      args: [
        "--no-sandbox",             
        "--disable-setuid-sandbox", 
        "--disable-dev-shm-usage",  
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
      ],
    },
  });

  client.on("qr", (qr) => {
    console.log(`⚠️ New QR Code generated for Admin ${adminId}. Scan required.`);
    sessionStatus.set(String(adminId), "QR_READY");
    qrCodeData.set(String(adminId), qr); 
  });

  client.on("ready", () => {
    console.log(`✅ WhatsApp Auto-Connected & Ready for Admin ID: ${adminId}`);
    sessionStatus.set(String(adminId), "CONNECTED");
    qrCodeData.delete(String(adminId)); 
    activeClients.set(sessionId, client);
  });

  client.on("disconnected", async (reason) => {
    console.log(`❌ WhatsApp Disconnected for Admin ${adminId}:`, reason);
    sessionStatus.set(String(adminId), "DISCONNECTED");
    qrCodeData.delete(String(adminId));
    activeClients.delete(sessionId);

    try {
      const user = await userRepo.findOne({ where: { id: Number(adminId) } });
      if (user) {
        user.whatsappInstanceId = null as any;
        user.whatsappToken = null as any;
        await userRepo.save(user);
        console.log(`🗑️ Cleared DB WhatsApp tokens for Admin ${adminId}.`);
      }
    } catch (err) {
      console.error("Cleanup error on DB disconnect:", err);
    }

    setTimeout(async () => {
      try {
        if (client) {
          await client.destroy();
          console.log(`🛑 Client destroyed safely for Admin ${adminId}`);
        }
      } catch (err) {}
    }, 3000);
  });

  registerMessageListener(client);

  try {
    await client.initialize();
    activeClients.set(sessionId, client);
    return client;
  } catch (error: any) {
    console.error(`❌ Failed to start WhatsApp for Admin ${adminId}:`, error?.message || error);
    sessionStatus.set(String(adminId), "DISCONNECTED");
  }
};

export const generateWhatsAppSession = (adminId: string, onQrCode: (qr: string) => void) => {
  const sessionId = `admin_${adminId}`;

  if (activeClients.has(sessionId)) {
    console.log(`WhatsApp already connected for Admin ID: ${adminId}`);
    sessionStatus.set(adminId, "CONNECTED");
    return;
  }

  // Agar pehle se initialize ho raha hai toh doosra browser mat kholo
  if (sessionStatus.get(adminId) === "INITIALIZING") {
    console.log(`⏳ WhatsApp is already initializing for Admin ID: ${adminId}. Please wait.`);
    return;
  }

  sessionStatus.set(adminId, "INITIALIZING");

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId }),
    puppeteer: { 
      headless: true, 
      args: [
        "--no-sandbox", 
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu"
      ] 
    }
  });

  client.on("qr", (qr) => {
    sessionStatus.set(adminId, "QR_READY");
    qrCodeData.set(adminId, qr); 
    onQrCode(qr);
  });

  client.on("ready", () => {
    console.log(`✅ WhatsApp Connected for Admin ID: ${adminId}`);
    sessionStatus.set(adminId, "CONNECTED");
    qrCodeData.delete(adminId); 
    activeClients.set(sessionId, client);
  });

  client.on("disconnected", async () => {
    console.log(`❌ WhatsApp Disconnected for Admin ID: ${adminId}`);
    sessionStatus.set(adminId, "DISCONNECTED");
    qrCodeData.delete(adminId);
    activeClients.delete(sessionId);

    try {
      const user = await userRepo.findOne({ where: { id: Number(adminId) } });
      if (user) {
        user.whatsappInstanceId = null as any;
        user.whatsappToken = null as any;
        await userRepo.save(user);
      }
    } catch (err) {
      console.error("Cleanup error on disconnect:", err);
    }

    setTimeout(async () => {
      try {
        if (client) {
          await client.destroy();
        }
      } catch (err) {}
    }, 3000);
  });

  registerMessageListener(client);

  // ⭐ YAHAN FIX KIYA HAI: Add proper catch to prevent Unhandled Rejection
  client.initialize().catch((err) => {
    console.error(`❌ Failed to generate session for Admin ${adminId}:`, err?.message || err);
    sessionStatus.set(adminId, "DISCONNECTED");
  });
};

const getOrRestoreClient = async (adminId: string | number): Promise<Client | null> => {
  const sessionId = `admin_${adminId}`;
  let client = activeClients.get(sessionId);

  if (!client) {
    const sessionPath = path.join(process.cwd(), `.wwebjs_auth/session-${sessionId}`);
    
    if (fs.existsSync(sessionPath)) {
      console.log(`⚠️ Client not in memory for Admin ${adminId}. Restoring from disk...`);
      
      client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: { 
          headless: true, 
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] 
        }
      });

      client.on("qr", (qr) => {
        sessionStatus.set(String(adminId), "QR_READY");
        qrCodeData.set(String(adminId), qr); 
      });

      client.on("ready", () => {
        console.log(`✅ Auto-reconnected WhatsApp for Admin ID: ${adminId}`);
        sessionStatus.set(String(adminId), "CONNECTED");
        qrCodeData.delete(String(adminId));
        activeClients.set(sessionId, client!);
      });

      client.on("disconnected", async () => {
        console.log(`❌ WhatsApp Disconnected for Admin ID: ${adminId}`);
        sessionStatus.set(String(adminId), "DISCONNECTED");
        qrCodeData.delete(String(adminId));
        activeClients.delete(sessionId);

        try {
          const user = await userRepo.findOne({ where: { id: Number(adminId) } });
          if (user) {
            user.whatsappInstanceId = null as any;
            user.whatsappToken = null as any;
            await userRepo.save(user);
          }
        } catch (err) {}

        setTimeout(async () => {
          try {
            if (client) {
              await client.destroy();
            }
          } catch (err) {}
        }, 3000);
      });

      registerMessageListener(client);

      // ⭐ YAHAN BHI FIX KIYA HAI
      client.initialize().catch((err) => {
        console.error(`❌ Failed to restore session for Admin ${adminId}:`, err?.message || err);
        sessionStatus.set(String(adminId), "DISCONNECTED");
      });

      activeClients.set(sessionId, client);
      
      await new Promise(resolve => setTimeout(resolve, 4000));
    } else {
      return null;
    }
  }
  return client;
};

export const getAdminClient = async (adminId: number) => {
  return await getOrRestoreClient(adminId);
};

export const sendAdminMessage = async (adminId: string | number, toPhone: string, message: string) => {
  try {
    const client = await getOrRestoreClient(adminId);
    if (!client) {
      console.log(`❌ WhatsApp is NOT connected for Admin ${adminId}. Message skipped.`);
      return false;
    }

    let cleanPhone = toPhone.replace(/\D/g, "");
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
    const formattedPhone = `${cleanPhone}@c.us`; 

    await client.sendMessage(formattedPhone, message);
    console.log(`✅ Message sent to ${formattedPhone}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send message to ${toPhone}:`, error);
    return false;
  }
};

export const sendAdminDocument = async (adminId: string | number, toPhone: string, filePath: string, caption: string) => {
  try {
    const client = await getOrRestoreClient(adminId);
    if (!client) {
      console.log(`❌ WhatsApp is NOT connected for Admin ${adminId}. PDF not sent.`);
      return false;
    }

    let cleanPhone = toPhone.replace(/\D/g, "");
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
    const formattedPhone = `${cleanPhone}@c.us`; 

    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString("base64");
    const fileName = path.basename(filePath);

    const media = new MessageMedia("application/pdf", base64Data, fileName);

    await client.sendMessage(formattedPhone, media, { caption: caption });
    
    console.log(`✅ PDF Document sent successfully to ${formattedPhone}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send PDF to ${toPhone}:`, error);
    return false;
  }
};