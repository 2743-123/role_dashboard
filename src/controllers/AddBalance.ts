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

// ✅ ADD BALANCE (Updated for User Access)
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

    // 🟢 Role-Based Validation: User sirf apne liye add kar sakta hai
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

    const flyashTons = flyashAmount / RATE_PER_TON;
    const bedashTons = bedashAmount / RATE_PER_TON;

    flyashAccount.totalTons += flyashTons;
    flyashAccount.remainingTons += flyashTons;

    bedashAccount.totalTons += bedashTons;
    bedashAccount.remainingTons += bedashTons;

    await accountRepo.save([flyashAccount, bedashAccount]);

    const transaction = transactionRepo.create({
      user,
      totalAmount: flyashAmount + bedashAmount,
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
      amount: flyashAmount + bedashAmount,
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

    // 🟢 CREATE BALANCE MESSAGE (Background Process)
    const adminUser = user.role === "user" ? user.creator : user;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;
    const dealerPhone = (user as any)?.phone || (user as any)?.mobile;

    if (dealerPhone) {
      (async () => {
        try {
          const balanceMsg =
            `💰 *New Balance Added Successfully!* 💰\n\n` +
            `👤 Dealer: *${user.name}*\n\n` +
            `📦 *Flyash:* \n` +
            `• Added: ₹${flyashAmount} (${flyashTons.toFixed(3)} Tons)\n` +
            `• New Total: *${flyashAccount.remainingTons.toFixed(3)} Tons*\n\n` +
            `📦 *Bedash:* \n` +
            `• Added: ₹${bedashAmount} (${bedashTons.toFixed(3)} Tons)\n` +
            `• New Total: *${bedashAccount.remainingTons.toFixed(3)} Tons*\n\n` +
            `💵 Total Amount Added: ₹${flyashAmount + bedashAmount}\n` +
            `💳 Payment Mode: ${paymentMode}\n` +
            `${
              paymentMode === "online"
                ? `🏦 Bank: ${bankName}\n🔢 Ref No: ${referenceNumber}\n`
                : ""
            }` +
            `\n- Bricks Admin System`;

          await sendWhatsAppReceipt(dealerPhone, balanceMsg, waInstance, waToken);
        } catch (waError) {
          console.error("WhatsApp notification failed on add:", waError);
        }
      })();
    }

    return res.json({ msg: "✅ Balance added successfully", data: transaction });
  } catch (error) {
    console.error("Error in addBalance:", error);
    return res.status(500).json({ msg: "Server error", error });
  }
};

// ✅ EDIT BALANCE (Updated for User Access)
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

    // 🟢 Role-Based Validation: User sirf apna entry edit kar sakta hai
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

    const oldFlyashTons = transaction.flyashTons;
    const oldBedashTons = transaction.bedashTons;
    const newFlyashTons = flyashAmount / RATE_PER_TON;
    const newBedashTons = bedashAmount / RATE_PER_TON;

    if (flyashAccount.remainingTons + oldFlyashTons < newFlyashTons)
      return res.status(400).json({ msg: "❌ Flyash already used. Can't reduce." });
    if (bedashAccount.remainingTons + oldBedashTons < newBedashTons)
      return res.status(400).json({ msg: "❌ Bedash already used. Can't reduce." });

    flyashAccount.totalTons = flyashAccount.totalTons - oldFlyashTons + newFlyashTons;
    flyashAccount.remainingTons = flyashAccount.remainingTons - oldFlyashTons + newFlyashTons;
    bedashAccount.totalTons = bedashAccount.totalTons - oldBedashTons + newBedashTons;
    bedashAccount.remainingTons = bedashAccount.remainingTons - oldBedashTons + newBedashTons;

    await accountRepo.save([flyashAccount, bedashAccount]);

    transaction.flyashAmount = flyashAmount;
    transaction.bedashAmount = bedashAmount;
    transaction.totalAmount = flyashAmount + bedashAmount;
    transaction.flyashTons = newFlyashTons;
    transaction.bedashTons = newBedashTons;

    await transactionRepo.save(transaction);

    // 🟠 EDIT BALANCE MESSAGE
    const targetUser = transaction.user;
    const adminUser = targetUser.role === "user" ? targetUser.creator : targetUser;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;
    const dealerPhone = (targetUser as any)?.phone || (targetUser as any)?.mobile;

    if (dealerPhone) {
      (async () => {
        try {
          const editMsg =
            `✏️ *Balance Updated Alert* ✏️\n\n` +
            `👤 Dealer: *${targetUser.name}*\n\n` +
            `Your recent balance entry has been updated.\n\n` +
            `📦 *Updated Flyash:* ₹${flyashAmount} (${newFlyashTons.toFixed(3)} Tons)\n` +
            `• Current Total: *${flyashAccount.remainingTons.toFixed(3)} Tons*\n\n` +
            `📦 *Updated Bedash:* ₹${bedashAmount} (${newBedashTons.toFixed(3)} Tons)\n` +
            `• Current Total: *${bedashAccount.remainingTons.toFixed(3)} Tons*\n\n` +
            `- Bricks Admin System`;

          await sendWhatsAppReceipt(dealerPhone, editMsg, waInstance, waToken);
        } catch (waErr) {
          console.error("WhatsApp delivery failed on edit:", waErr);
        }
      })();
    }

    return res.json({ msg: "✅ Balance updated successfully", data: transaction });
  } catch (error) {
    console.error("Edit balance error:", error);
    return res.status(500).json({ msg: "Server error" });
  }
};

// ✅ DELETE BALANCE (Updated for User Access)
export const deleteBalance = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;
    const currentUser = req.user!;

    const transaction = await transactionRepo.findOne({
      where: { id: Number(transactionId) },
      relations: ["user", "user.creator"],
    });

    if (!transaction) return res.status(404).json({ msg: "Transaction not found" });

    // 🟢 Role-Based Validation: User sirf apna entry delete kar sakta hai
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

    flyashAccount.totalTons -= transaction.flyashTons;
    flyashAccount.remainingTons -= transaction.flyashTons;
    bedashAccount.totalTons -= transaction.bedashTons;
    bedashAccount.remainingTons -= transaction.bedashTons;

    const deletedFlyashTons = transaction.flyashTons;
    const deletedBedashTons = transaction.bedashTons;
    
    // Store credentials before deleting transaction object
    const targetUser = transaction.user;
    const adminUser = targetUser.role === "user" ? targetUser.creator : targetUser;
    const waInstance = (adminUser as any)?.whatsappInstanceId;
    const waToken = (adminUser as any)?.whatsappToken;
    const dealerPhone = (targetUser as any)?.phone || (targetUser as any)?.mobile;

    await accountRepo.save([flyashAccount, bedashAccount]);
    await transactionRepo.remove(transaction);

    // 🔴 DELETE BALANCE MESSAGE
    if (dealerPhone) {
      (async () => {
        try {
          const deleteMsg =
            `❌ *Balance Entry Deleted* ❌\n\n` +
            `👤 Dealer: *${targetUser.name}*\n\n` +
            `Your latest balance addition has been removed.\n\n` +
            `📉 *Deducted Stock:*\n` +
            `• Flyash: -${deletedFlyashTons.toFixed(3)} Tons\n` +
            `• Bedash: -${deletedBedashTons.toFixed(3)} Tons\n\n` +
            `📊 *Your New Remaining Balance:*\n` +
            `• Flyash: ${flyashAccount.remainingTons.toFixed(3)} Tons\n` +
            `• Bedash: ${bedashAccount.remainingTons.toFixed(3)} Tons\n\n` +
            `- Bricks Admin System`;

          await sendWhatsAppReceipt(dealerPhone, deleteMsg, waInstance, waToken);
        } catch (waErr) {
          console.error("WhatsApp delivery failed on delete:", waErr);
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