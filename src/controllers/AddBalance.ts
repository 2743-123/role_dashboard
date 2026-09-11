import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import { MaterialAccount } from "../models/materialaccount";
import { Transaction } from "../models/Transaction";
import { In } from "typeorm";
import { PaymentHistory } from "../models/PaymentHistory";
import { sendWhatsAppReceipt } from "../services/whatsappService";

const userRepo = AppDataSource.getRepository(User);
const accountRepo = AppDataSource.getRepository(MaterialAccount);
const transactionRepo = AppDataSource.getRepository(Transaction);
const paymentHistoryRepo = AppDataSource.getRepository(PaymentHistory);

const RATE_PER_TON = 180;
const TRUCK_CAPACITY = 27; // 27 Tons per token/truck

// ✅ ADD BALANCE (Alert strictly to Admin)
export const addBalance = async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;
    const {
      userId,
      flyashAmount = 0,
      bedashAmount = 0,
      paymentMode,
      bankName,
      accountHolder,
      referenceNumber,
    } = req.body;

    if (flyashAmount < 0 || bedashAmount < 0) {
      return res.status(400).json({ msg: "❌ Amounts cannot be negative" });
    }

    const user = await userRepo.findOne({
      where: { id: userId },
      relations: ["creator"],
    });

    if (!user) return res.status(404).json({ msg: "User not found" });

    if (currentUser.role === "user" && currentUser.id !== user.id) {
      return res.status(403).json({ msg: "❌ You can only add balance to your own account" });
    }

    if (currentUser.role === "admin" && user.creator?.id !== currentUser.id) {
      return res.status(403).json({ msg: "❌ Access Denied: Not your user" });
    }

    const getOrCreateAccount = async (materialType: "flyash" | "bedash") => {
      let account = await accountRepo.findOne({
        where: { user: { id: user.id }, materialType },
      });
      if (!account) {
        account = accountRepo.create({
          user,
          materialType,
          totalTons: 0,
          usedTons: 0,
          remainingTons: 0,
        });
      }
      return account;
    };

    const flyashAccount = await getOrCreateAccount("flyash");
    const bedashAccount = await getOrCreateAccount("bedash");

    const oldFlyashRemaining = Number(flyashAccount.remainingTons || 0);
    const oldBedashRemaining = Number(bedashAccount.remainingTons || 0);

    const flyashTons = Number(flyashAmount) / RATE_PER_TON;
    const bedashTons = Number(bedashAmount) / RATE_PER_TON;

    flyashAccount.totalTons += flyashTons;
    flyashAccount.remainingTons += flyashTons;

    bedashAccount.totalTons += bedashTons;
    bedashAccount.remainingTons += bedashTons;

    await accountRepo.save([flyashAccount, bedashAccount]);

    const totalMoney = Number(flyashAmount) + Number(bedashAmount);

    const transaction = transactionRepo.create({
      user,
      totalAmount: totalMoney,
      flyashAmount,
      bedashAmount,
      flyashTons,
      bedashTons,
      paymentMode,
      bankName: paymentMode === "online" ? bankName : null,
      accountHolder: paymentMode === "online" ? accountHolder : null,
      referenceNumber: paymentMode === "online" ? referenceNumber : null,
    });

    await transactionRepo.save(transaction);

    const history = paymentHistoryRepo.create({
      user,
      admin: { id: currentUser.id } as any,
      type: "add_balance",
      amount: totalMoney,
      details: {
        flyashAmount,
        bedashAmount,
        flyashTons,
        bedashTons,
        paymentMode,
        referenceNumber,
      },
    });
    await paymentHistoryRepo.save(history);

    const flyashTokensAvail = (flyashAccount.remainingTons / TRUCK_CAPACITY).toFixed(1);
    const bedashTokensAvail = (bedashAccount.remainingTons / TRUCK_CAPACITY).toFixed(1);

    // 🟢 ADMIN DETAILS EXTRACT KAREIN (Sirf Admin ko message bhejne ke liye)
    const adminUser = user.role === "user" ? user.creator : user;
    const adminPhone = (adminUser as any)?.phone || (currentUser as any)?.phone;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;

    if (adminPhone) {
      (async () => {
        try {
          const balanceMsg =
            `💰 *Admin Alert: New Balance Added!* 💰\n\n` +
            `👤 Dealer: *${user.name}*\n` +
            `📅 Date: ${new Date().toLocaleDateString("en-GB")}\n\n` +
            `📦 *Fly Ash Details:*\n` +
            `• Added Amount: ₹${flyashAmount}\n` +
            `• Stock Added: +${flyashTons.toFixed(3)} Tons\n` +
            `• Calculation: ${oldFlyashRemaining.toFixed(3)} + ${flyashTons.toFixed(3)}\n` +
            `• Final Remaining: *${flyashAccount.remainingTons.toFixed(3)} Tons*\n` +
            `• 🎫 Available Tokens: ~${flyashTokensAvail} Tokens\n\n` +
            `📦 *Bed Ash Details:*\n` +
            `• Added Amount: ₹${bedashAmount}\n` +
            `• Stock Added: +${bedashTons.toFixed(3)} Tons\n` +
            `• Calculation: ${oldBedashRemaining.toFixed(3)} + ${bedashTons.toFixed(3)}\n` +
            `• Final Remaining: *${bedashAccount.remainingTons.toFixed(3)} Tons*\n` +
            `• 🎫 Available Tokens: ~${bedashTokensAvail} Tokens\n\n` +
            `💵 *Total Amount:* ₹${totalMoney}\n` +
            `💳 *Payment Mode:* ${paymentMode.toUpperCase()}\n` +
            `${
              paymentMode === "online"
                ? `🏦 Bank: ${bankName || "N/A"}\n👤 Holder: ${accountHolder || "N/A"}\n🔢 Ref No: ${referenceNumber || "N/A"}\n`
                : ""
            }\n` +
            `- Bricks Admin Management`;

          await sendWhatsAppReceipt(adminPhone, balanceMsg, waInstance, waToken);
        } catch (waError) {
          console.error("WhatsApp delivery failed on add balance:", waError);
        }
      })();
    }

    return res.json({ msg: "✅ Balance added successfully", data: transaction });
  } catch (error) {
    console.error("Error in addBalance:", error);
    return res.status(500).json({ msg: "Server error", error });
  }
};

// ✅ EDIT BALANCE (Alert strictly to Admin)
export const editBalance = async (req: Request, res: Response) => {
  try {
    const { transactionId, flyashAmount = 0, bedashAmount = 0 } = req.body;
    const currentUser = req.user!;

    if (flyashAmount < 0 || bedashAmount < 0) {
      return res.status(400).json({ msg: "❌ Amounts cannot be negative" });
    }

    const transaction = await transactionRepo.findOne({
      where: { id: transactionId },
      relations: ["user", "user.creator"],
    });

    if (!transaction) return res.status(404).json({ msg: "Transaction not found" });

    if (currentUser.role === "user" && transaction.user.id !== currentUser.id) {
      return res.status(403).json({ msg: "❌ You can only edit your own balance" });
    }

    if (currentUser.role === "admin" && transaction.user.creator?.id !== currentUser.id) {
      return res.status(403).json({ msg: "❌ Access Denied: Not your user's transaction" });
    }

    const flyashAccount = await accountRepo.findOne({
      where: { user: { id: transaction.user.id }, materialType: "flyash" },
    });
    const bedashAccount = await accountRepo.findOne({
      where: { user: { id: transaction.user.id }, materialType: "bedash" },
    });

    if (!flyashAccount || !bedashAccount) return res.status(400).json({ msg: "Material account missing" });

    const prevRemainingFlyash = Number(flyashAccount.remainingTons || 0);
    const prevRemainingBedash = Number(bedashAccount.remainingTons || 0);

    const oldFlyashTons = Number(transaction.flyashTons || 0);
    const oldBedashTons = Number(transaction.bedashTons || 0);
    const newFlyashTons = Number(flyashAmount) / RATE_PER_TON;
    const newBedashTons = Number(bedashAmount) / RATE_PER_TON;

    const flyashDiffTons = newFlyashTons - oldFlyashTons;
    const bedashDiffTons = newBedashTons - oldBedashTons;

    if (flyashAccount.remainingTons + oldFlyashTons < newFlyashTons) {
      return res.status(400).json({ msg: "❌ Flyash already used. Can't reduce." });
    }
    if (bedashAccount.remainingTons + oldBedashTons < newBedashTons) {
      return res.status(400).json({ msg: "❌ Bedash already used. Can't reduce." });
    }

    flyashAccount.totalTons = flyashAccount.totalTons - oldFlyashTons + newFlyashTons;
    flyashAccount.remainingTons = flyashAccount.remainingTons - oldFlyashTons + newFlyashTons;
    bedashAccount.totalTons = bedashAccount.totalTons - oldBedashTons + newBedashTons;
    bedashAccount.remainingTons = bedashAccount.remainingTons - oldBedashTons + newBedashTons;

    await accountRepo.save([flyashAccount, bedashAccount]);

    transaction.flyashAmount = flyashAmount;
    transaction.bedashAmount = bedashAmount;
    transaction.totalAmount = Number(flyashAmount) + Number(bedashAmount);
    transaction.flyashTons = newFlyashTons;
    transaction.bedashTons = newBedashTons;

    await transactionRepo.save(transaction);

    const flyashTokensAvail = (flyashAccount.remainingTons / TRUCK_CAPACITY).toFixed(1);
    const bedashTokensAvail = (bedashAccount.remainingTons / TRUCK_CAPACITY).toFixed(1);

    const targetUser = transaction.user;
    const adminUser = targetUser.role === "user" ? targetUser.creator : targetUser;
    const adminPhone = (adminUser as any)?.phone || (currentUser as any)?.phone;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;

    if (adminPhone) {
      (async () => {
        try {
          const editMsg =
            `✏️ *Admin Alert: Balance Entry Updated* ✏️\n\n` +
            `👤 Dealer: *${targetUser.name}*\n` +
            `🔢 Transaction ID: #${transaction.id}\n\n` +
            `📦 *Fly Ash Adjustment:*\n` +
            `• Old Entry: ${oldFlyashTons.toFixed(3)} Tons\n` +
            `• New Entry: ${newFlyashTons.toFixed(3)} Tons (₹${flyashAmount})\n` +
            `• Stock Change: ${flyashDiffTons >= 0 ? `+${flyashDiffTons.toFixed(3)}` : flyashDiffTons.toFixed(3)} Tons\n` +
            `• Remaining Stock: *${flyashAccount.remainingTons.toFixed(3)} Tons*\n` +
            `• 🎫 Available Tokens: ~${flyashTokensAvail} Tokens\n\n` +
            `📦 *Bed Ash Adjustment:*\n` +
            `• Old Entry: ${oldBedashTons.toFixed(3)} Tons\n` +
            `• New Entry: ${newBedashTons.toFixed(3)} Tons (₹${bedashAmount})\n` +
            `• Stock Change: ${bedashDiffTons >= 0 ? `+${bedashDiffTons.toFixed(3)}` : bedashDiffTons.toFixed(3)} Tons\n` +
            `• Remaining Stock: *${bedashAccount.remainingTons.toFixed(3)} Tons*\n` +
            `• 🎫 Available Tokens: ~${bedashTokensAvail} Tokens\n\n` +
            `💵 *Updated Total:* ₹${transaction.totalAmount}\n\n` +
            `- Bricks Admin Management`;

          await sendWhatsAppReceipt(adminPhone, editMsg, waInstance, waToken);
        } catch (waErr) {
          console.error("WhatsApp delivery failed on edit balance:", waErr);
        }
      })();
    }

    return res.json({ msg: "✅ Balance updated successfully", data: transaction });
  } catch (error) {
    console.error("Edit balance error:", error);
    return res.status(500).json({ msg: "Server error" });
  }
};

// ✅ DELETE BALANCE (Alert strictly to Admin)
export const deleteBalance = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;
    const currentUser = req.user!;

    const transaction = await transactionRepo.findOne({
      where: { id: Number(transactionId) },
      relations: ["user", "user.creator"],
    });

    if (!transaction) return res.status(404).json({ msg: "Transaction not found" });

    if (currentUser.role === "user" && transaction.user.id !== currentUser.id) {
      return res.status(403).json({ msg: "❌ You can only delete your own balance entry" });
    }

    if (currentUser.role === "admin" && transaction.user.creator?.id !== currentUser.id) {
      return res.status(403).json({ msg: "❌ Access Denied: Not your user's transaction" });
    }

    const lastTransaction = await transactionRepo.findOne({
      where: { user: { id: transaction.user.id } },
      order: { id: "DESC" },
    });

    if (!lastTransaction || lastTransaction.id !== transaction.id) {
      return res.status(400).json({ msg: "❌ Only latest balance entry can be deleted" });
    }

    const flyashAccount = await accountRepo.findOne({
      where: { user: { id: transaction.user.id }, materialType: "flyash" },
    });
    const bedashAccount = await accountRepo.findOne({
      where: { user: { id: transaction.user.id }, materialType: "bedash" },
    });

    if (!flyashAccount || !bedashAccount) return res.status(400).json({ msg: "Material account missing" });

    if (flyashAccount.remainingTons < transaction.flyashTons) {
      return res.status(400).json({ msg: "❌ Flyash already used. Can't delete balance." });
    }
    if (bedashAccount.remainingTons < transaction.bedashTons) {
      return res.status(400).json({ msg: "❌ Bedash already used. Can't delete balance." });
    }

    const deletedFlyashTons = Number(transaction.flyashTons);
    const deletedBedashTons = Number(transaction.bedashTons);
    const deletedFlyashAmount = Number(transaction.flyashAmount);
    const deletedBedashAmount = Number(transaction.bedashAmount);
    const deletedTotalAmount = Number(transaction.totalAmount);

    flyashAccount.totalTons -= deletedFlyashTons;
    flyashAccount.remainingTons -= deletedFlyashTons;
    bedashAccount.totalTons -= deletedBedashTons;
    bedashAccount.remainingTons -= deletedBedashTons;

    const targetUser = transaction.user;
    const adminUser = targetUser.role === "user" ? targetUser.creator : targetUser;
    const adminPhone = (adminUser as any)?.phone || (currentUser as any)?.phone;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;

    await accountRepo.save([flyashAccount, bedashAccount]);
    await transactionRepo.remove(transaction);

    const flyashTokensAvail = (flyashAccount.remainingTons / TRUCK_CAPACITY).toFixed(1);
    const bedashTokensAvail = (bedashAccount.remainingTons / TRUCK_CAPACITY).toFixed(1);

    if (adminPhone) {
      (async () => {
        try {
          const deleteMsg =
            `❌ *Admin Alert: Balance Entry Removed* ❌\n\n` +
            `👤 Dealer: *${targetUser.name}*\n` +
            `🔢 Transaction ID: #${transaction.id}\n\n` +
            `📦 *Stock Deducted:*\n` +
            `• Fly Ash: -${deletedFlyashTons.toFixed(3)} Tons (₹${deletedFlyashAmount})\n` +
            `• Remaining Fly Ash: *${flyashAccount.remainingTons.toFixed(3)} Tons* (~${flyashTokensAvail} Tokens)\n\n` +
            `• Bed Ash: -${deletedBedashTons.toFixed(3)} Tons (₹${deletedBedashAmount})\n` +
            `• Remaining Bed Ash: *${bedashAccount.remainingTons.toFixed(3)} Tons* (~${bedashTokensAvail} Tokens)\n\n` +
            `💵 *Total Amount Removed:* ₹${deletedTotalAmount}\n\n` +
            `- Bricks Admin Management`;

          await sendWhatsAppReceipt(adminPhone, deleteMsg, waInstance, waToken);
        } catch (waErr) {
          console.error("WhatsApp delivery failed on delete balance:", waErr);
        }
      })();
    }

    return res.json({ msg: "🗑️ Balance deleted successfully" });
  } catch (error) {
    console.error("Delete balance error:", error);
    return res.status(500).json({ msg: "Server error" });
  }
};

export const getBalance = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = req.user!;

    const user = await userRepo.findOne({
      where: { id: Number(userId) },
      relations: ["creator"],
    });

    if (!user) return res.status(404).json({ msg: "User not found" });

    if (currentUser.role === "user" && currentUser.id !== Number(userId)) {
      return res.status(403).json({ msg: "❌ Access Denied" });
    }

    if (currentUser.role === "admin" && user.creator?.id !== currentUser.id) {
      return res.status(403).json({ msg: "❌ Access Denied: Not your user" });
    }

    const flyashAccount = await accountRepo.findOne({
      where: { user: { id: user.id }, materialType: "flyash" },
    });
    const bedashAccount = await accountRepo.findOne({
      where: { user: { id: user.id }, materialType: "bedash" },
    });

    const transactions = await transactionRepo.find({
      where: { user: { id: user.id } },
      order: { createdAt: "DESC" },
    });

    const formattedTransactions = transactions.map((tx) => ({
      id: tx.id,
      date: tx.createdAt,
      flyashAmount: tx.flyashAmount,
      bedashAmount: tx.bedashAmount,
      totalAmount: tx.totalAmount,
      flyashTons: Number(tx.flyashTons).toFixed(3),
      bedashTons: Number(tx.bedashTons).toFixed(3),
      paymentMode: tx.paymentMode,
      bankName: tx.bankName,
      accountHolder: tx.accountHolder,
      referenceNumber: tx.referenceNumber,
    }));

    return res.json({
      user: { id: user.id, name: user.name },
      flyash: flyashAccount
        ? {
            total: Number(flyashAccount.totalTons).toFixed(3),
            used: Number(flyashAccount.usedTons).toFixed(3),
            remaining: Number(flyashAccount.remainingTons).toFixed(3),
          }
        : { total: "0.000", used: "0.000", remaining: "0.000" },
      bedash: bedashAccount
        ? {
            total: Number(bedashAccount.totalTons).toFixed(3),
            used: Number(bedashAccount.usedTons).toFixed(3),
            remaining: Number(bedashAccount.remainingTons).toFixed(3),
          }
        : { total: "0.000", used: "0.000", remaining: "0.000" },
      transactions: formattedTransactions,
    });
  } catch (error) {
    console.error("Error in getBalanceWithTransactions:", error);
    res.status(500).json({ msg: "Server error", error });
  }
};

export const getAllUsersBalanceReport = async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;

    if (currentUser.role === "user") {
      return res.status(403).json({ msg: "❌ Access denied" });
    }

    let users: User[] = [];

    if (currentUser.role === "superadmin") {
      users = await userRepo.find({ where: { role: "user" }, order: { name: "ASC" } });
    } else if (currentUser.role === "admin") {
      users = await userRepo.find({
        where: { role: "user", creator: { id: currentUser.id } },
        order: { name: "ASC" },
      });
    }

    const userIds = users.map((u) => u.id);

    if (userIds.length === 0) {
      return res.json({ msg: "✅ Admin balance report fetched", totalUsers: 0, data: [] });
    }

    let allAccounts: MaterialAccount[] = [];
    let allTransactions: Transaction[] = [];

    allAccounts = await accountRepo.find({
      where: { user: { id: In(userIds) } },
      relations: ["user"],
    });
    allTransactions = await transactionRepo.find({
      where: { user: { id: In(userIds) } },
      relations: ["user"],
      order: { createdAt: "DESC" },
    });

    const report = users.map((user) => {
      const flyashAccount = allAccounts.find(
        (a) => a.user.id === user.id && a.materialType === "flyash"
      );
      const bedashAccount = allAccounts.find(
        (a) => a.user.id === user.id && a.materialType === "bedash"
      );
      const userTransactions = allTransactions.filter((t) => t.user.id === user.id);

      return {
        userId: user.id,
        userName: user.name,
        flyash: {
          total: flyashAccount ? Number(flyashAccount.totalTons).toFixed(3) : "0.000",
          used: flyashAccount ? Number(flyashAccount.usedTons).toFixed(3) : "0.000",
          remaining: flyashAccount ? Number(flyashAccount.remainingTons).toFixed(3) : "0.000",
        },
        bedash: {
          total: bedashAccount ? Number(bedashAccount.totalTons).toFixed(3) : "0.000",
          used: bedashAccount ? Number(bedashAccount.usedTons).toFixed(3) : "0.000",
          remaining: bedashAccount ? Number(bedashAccount.remainingTons).toFixed(3) : "0.000",
        },
        ratePerTon: RATE_PER_TON,
        transactions: userTransactions.map((tx) => ({
          id: tx.id,
          date: tx.createdAt,
          flyashAmount: tx.flyashAmount,
          bedashAmount: tx.bedashAmount,
          totalAmount: tx.totalAmount,
          flyashTons: Number(tx.flyashTons).toFixed(3),
          bedashTons: Number(tx.bedashTons).toFixed(3),
          paymentMode: tx.paymentMode,
          referenceNumber: tx.referenceNumber,
        })),
      };
    });

    return res.json({
      msg: "✅ Admin balance report fetched",
      totalUsers: report.length,
      data: report,
    });
  } catch (error) {
    console.error("Error in admin balance report:", error);
    return res.status(500).json({ msg: "Server error", error });
  }
};