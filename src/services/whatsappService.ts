import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import fs from "fs";
import path from "path";
import { AppDataSource } from "../config/db";
import { Token } from "../models/Token";
import { User } from "../models/User";
import { MaterialAccount } from "../models/materialaccount";
import { generateAndSendUserReportPDF } from "./whatappSendServices";

// ⭐ MASTER SWITCH: Isko 'true' rakhne se WhatsApp aur Chrome start nahi hoga (RAM bachegi).
// Future me jab aap server/VPS upgrade karein, toh isko bas 'false' kar dena!
const DISABLE_WHATSAPP = true;

// ⭐ PRODUCTION FIX: Prevent Node.js server crashes from internal Puppeteer/WhatsApp errors
process.on("unhandledRejection", (reason: any, promise) => {
  const errorMsg = reason?.message || String(reason);
  if (
    errorMsg.includes("Execution context was destroyed") ||
    errorMsg.includes("Attempted to use detached Frame") ||
    errorMsg.includes("EBUSY") ||
    errorMsg.includes("Session closed") ||
    errorMsg.includes("Target closed") ||
    errorMsg.includes("The browser is already running")
  ) {
    console.log("⚠️ Suppressed internal Puppeteer error:", errorMsg.split('\n')[0]);
  } else {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
  }
});

export const sessionStatus = new Map<string, string>(); 
export const qrCodeData = new Map<string, string>(); 
const activeClients = new Map<string, Client>(); 

// ⭐ RACE CONDITION LOCK: Prevents multiple browsers from opening for the same admin
const initializingClients = new Set<string>();

const tokenRepo = AppDataSource.getRepository(Token);
const userRepo = AppDataSource.getRepository(User);
const accountRepo = AppDataSource.getRepository(MaterialAccount);

// ==========================================
// 🧹 Helper: Clean Orphaned Lock Files
// ==========================================
const cleanLockFile = (sessionId: string) => {
  if (DISABLE_WHATSAPP) return;
  const lockFilePath = path.join(process.cwd(), ".wwebjs_auth", `session-${sessionId}`, "SingletonLock");
  if (fs.existsSync(lockFilePath)) {
    try {
      fs.unlinkSync(lockFilePath);
      console.log(`🧹 Cleared orphaned browser lock for ${sessionId}`);
    } catch (err) {}
  }
};

const registerMessageListener = (client: Client) => {
  if (DISABLE_WHATSAPP) return;
  
  client.on("message", async (msg) => {
    try {
      let senderPhone = "";
      const rawChatId = msg.from;
      if (rawChatId.includes("156126406566128") || rawChatId.includes("917622855036")) {
        senderPhone = "7622855036"; 
      } else if (msg.from.includes("@lid")) {
        try {
          const contact = await msg.getContact();
          if (contact && contact.number) senderPhone = contact.number;
        } catch (err) {}
      }

      if (!senderPhone) {
        senderPhone = msg.from.replace("@c.us", "").replace("@s.whatsapp.net", "").replace("+", "");
      }

      const messageBody = msg.body?.trim().toLowerCase();

      if (senderPhone && (messageBody === "hi" || messageBody === "hello" || messageBody === "report")) {
        const matchingToken = await tokenRepo.createQueryBuilder("token")
          .leftJoinAndSelect("token.user", "user")
          .leftJoinAndSelect("user.creator", "creator")
          .where("token.customerPhone LIKE :phone OR token.customerPhone LIKE :plusPhone", { phone: `%${senderPhone}%`, plusPhone: `%+${senderPhone}%` })
          .orderBy("token.id", "DESC")
          .getOne();

        if (matchingToken) {
          const customerName = matchingToken.customerName;
          const assignedUser = matchingToken.user; 
          const customerTokens = await tokenRepo.createQueryBuilder("token").where("token.customerPhone LIKE :phone OR token.customerPhone LIKE :plusPhone", { phone: `%${senderPhone}%`, plusPhone: `%+${senderPhone}%` }).orderBy("token.id", "DESC").getMany();
          const accounts = await accountRepo.find({ where: { user: { id: assignedUser.id } } });
          const adminUser = assignedUser.role === "user" ? assignedUser.creator : assignedUser;
          const targetAdminId = adminUser?.id || assignedUser.id;

          await generateAndSendUserReportPDF({ id: assignedUser.id, name: customerName, email: assignedUser.email || "customer@bricks.com" } as any, customerTokens, accounts, { adminId: targetAdminId, phone: senderPhone });
          console.log(`✅ Auto PDF token report sent to Customer: ${customerName} (${senderPhone})`);
        } else {
          const user = await userRepo.createQueryBuilder("user").leftJoinAndSelect("user.creator", "creator").where("user.phone LIKE :phone OR user.phone LIKE :plusPhone", { phone: `%${senderPhone}%`, plusPhone: `%+${senderPhone}%` }).getOne();
          if (user) {
            const tokens = await tokenRepo.find({ where: { user: { id: user.id } }, order: { id: "DESC" } });
            const accounts = await accountRepo.find({ where: { user: { id: user.id } } });
            const adminUser = user.role === "user" ? user.creator : user;
            const targetAdminId = adminUser?.id || user.id;

            await generateAndSendUserReportPDF(user, tokens, accounts, { adminId: targetAdminId, phone: senderPhone });
            console.log(`✅ Auto PDF report sent to Dealer: ${user.name} (${senderPhone})`);
          }
        }
      }
    } catch (error) {
      console.error("Webhook/Message Event Error:", error);
    }
  });
};

// ⭐ 1. INSTANT STATUS CHECK (For SuperAdmin UI Fast Response)
export const getWhatsAppStatus = (adminId: string | number): string => {
  if (DISABLE_WHATSAPP) return "DISCONNECTED";

  const currentStatus = sessionStatus.get(String(adminId));
  if (currentStatus === "CONNECTED" || currentStatus === "QR_READY") return currentStatus;

  const sessionId = `admin_${adminId}`;
  const sessionPath = path.join(process.cwd(), ".wwebjs_auth", `session-${sessionId}`);

  if (fs.existsSync(sessionPath)) {
    sessionStatus.set(String(adminId), "CONNECTED"); 
    getOrRestoreClient(adminId).catch(() => {});
    return "CONNECTED";
  }

  sessionStatus.set(String(adminId), "DISCONNECTED");
  return "DISCONNECTED";
};

// ⭐ 2. BACKGROUND RESTORE LOGIC
const getOrRestoreClient = async (adminId: string | number): Promise<Client | null> => {
  if (DISABLE_WHATSAPP) return null;

  const sessionId = `admin_${adminId}`;
  
  if (activeClients.has(sessionId)) return activeClients.get(sessionId)!;
  if (initializingClients.has(sessionId)) return null; 

  const sessionPath = path.join(process.cwd(), `.wwebjs_auth/session-${sessionId}`);
  if (!fs.existsSync(sessionPath)) return null;

  initializingClients.add(sessionId); 
  cleanLockFile(sessionId); 

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId }),
    puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] }
  });

  client.on("qr", async () => {
    console.log(`⚠️ Admin ${adminId} session expired. Killing background process.`);
    sessionStatus.set(String(adminId), "DISCONNECTED");
    setTimeout(async () => { try { if (client) await client.destroy(); } catch (err) {} }, 1000);
  });

  client.on("ready", () => {
    console.log(`✅ Auto-reconnected WhatsApp for Admin ID: ${adminId}`);
    sessionStatus.set(String(adminId), "CONNECTED");
    activeClients.set(sessionId, client);
  });

  client.on("disconnected", async () => {
    sessionStatus.set(String(adminId), "DISCONNECTED");
    activeClients.delete(sessionId);
    setTimeout(async () => { try { if (client) await client.destroy(); } catch (err) {} }, 2000);
  });

  registerMessageListener(client);

  try {
    await client.initialize();
    activeClients.set(sessionId, client);
  } catch (err: any) {
    sessionStatus.set(String(adminId), "DISCONNECTED");
  } finally {
    initializingClients.delete(sessionId); 
  }

  return activeClients.get(sessionId) || null;
};

// ⭐ 3. GENERATE NEW QR
export const generateWhatsAppSession = async (adminId: string, onQrCode: (qr: string) => void) => {
  if (DISABLE_WHATSAPP) {
    console.log("⚠️ WhatsApp feature is temporarily disabled to save RAM.");
    return;
  }

  const sessionId = `admin_${adminId}`;

  if (activeClients.has(sessionId)) {
    sessionStatus.set(adminId, "CONNECTED");
    return;
  }
  if (initializingClients.has(sessionId)) return;

  initializingClients.add(sessionId);
  sessionStatus.set(adminId, "INITIALIZING");

  const existingClient = activeClients.get(sessionId);
  if (existingClient) {
    try { await existingClient.destroy(); } catch (e) {}
    activeClients.delete(sessionId);
  }

  cleanLockFile(sessionId);
  await new Promise(resolve => setTimeout(resolve, 1500)); 

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId }),
    puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-accelerated-2d-canvas", "--disable-gpu"] }
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
    sessionStatus.set(adminId, "DISCONNECTED");
    qrCodeData.delete(adminId);
    activeClients.delete(sessionId);
    setTimeout(async () => { try { if (client) await client.destroy(); } catch (err) {} }, 2000);
  });

  registerMessageListener(client);

  try {
    await client.initialize();
  } catch (err: any) {
    sessionStatus.set(adminId, "DISCONNECTED");
  } finally {
    initializingClients.delete(sessionId); 
  }
};

// ⭐ 4. SUPER ADMIN LOGIN HO TO SARE ADMINS KO CONNECT KARO
export const initAllSavedSessions = async () => {
  if (DISABLE_WHATSAPP) return;

  const authPath = path.join(process.cwd(), ".wwebjs_auth");
  if (!fs.existsSync(authPath)) return;

  const folders = fs.readdirSync(authPath);
  for (const folder of folders) {
    if (folder.startsWith("session-admin_")) {
      const adminId = folder.split("_")[1];
      console.log(`🚀 Found existing session for Admin ${adminId}, attempting auto-connect...`);
      getOrRestoreClient(adminId).catch(() => {});
    }
  }
};

export const initWhatsAppOnLogin = async (adminId: number) => {
  if (DISABLE_WHATSAPP) return null;
  return await getOrRestoreClient(adminId);
};

export const getAdminClient = async (adminId: number) => {
  if (DISABLE_WHATSAPP) return null;
  return await getOrRestoreClient(adminId);
};

export const sendAdminMessage = async (adminId: string | number, toPhone: string, message: string) => {
  if (DISABLE_WHATSAPP) return false;

  try {
    const client = await getOrRestoreClient(adminId);
    if (!client) return false;
    let cleanPhone = toPhone.replace(/\D/g, "");
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
    await client.sendMessage(`${cleanPhone}@c.us`, message);
    return true;
  } catch (error) { return false; }
};

export const sendAdminDocument = async (adminId: string | number, toPhone: string, filePath: string, caption: string) => {
  if (DISABLE_WHATSAPP) return false;

  try {
    const client = await getOrRestoreClient(adminId);
    if (!client) return false;
    let cleanPhone = toPhone.replace(/\D/g, "");
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
    const media = new MessageMedia("application/pdf", fs.readFileSync(filePath).toString("base64"), path.basename(filePath));
    await client.sendMessage(`${cleanPhone}@c.us`, media, { caption: caption });
    return true;
  } catch (error) { return false; }
};