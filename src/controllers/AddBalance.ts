import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import { MaterialAccount } from "../models/materialaccount";
import { Transaction } from "../models/Transaction";

const userRepo = AppDataSource.getRepository(User);
const accountRepo = AppDataSource.getRepository(MaterialAccount);
const transactionRepo = AppDataSource.getRepository(Transaction);

const RATE_PER_TON = 180; // ₹ per ton (same as your other code)
export const addBalance = async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!; // logged in user
    const {
      userId,
      flyashAmount = 0,
      bedashAmount = 0,
      paymentMode,
      bankName,
      accountHolder,
      referenceNumber,
    } = req.body;

    // 1️⃣ Validate user
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return res.status(404).json({ msg: "User not found" });

    // 2️⃣ Superadmin/Admin permission
    if (
      currentUser.role === "user" ||
      (currentUser.role === "admin" && user.role !== "user")
    ) {
      return res
        .status(403)
        .json({ msg: "❌ You don't have permission to add balance" });
    }

    // 3️⃣ Get or create MaterialAccounts
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

    // 4️⃣ Calculate tons from amount
    const flyashTons = flyashAmount / RATE_PER_TON;
    const bedashTons = bedashAmount / RATE_PER_TON;

    // 5️⃣ Update accounts
    flyashAccount.totalTons += flyashTons;
    flyashAccount.remainingTons += flyashTons;

    bedashAccount.totalTons += bedashTons;
    bedashAccount.remainingTons += bedashTons;

    await accountRepo.save([flyashAccount, bedashAccount]);

    // 6️⃣ Create transaction entry
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

    return res.json({
      msg: "✅ Balance added successfully",
      data: transaction,
    });
  } catch (error) {
    console.error("Error in addBalance:", error);
    return res.status(500).json({ msg: "Server error", error });
  }
};

export const getBalance = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = req.user!; // Logged in user

    // 1️⃣ Validate user
    const user = await userRepo.findOne({ where: { id: Number(userId) } });
    if (!user) return res.status(404).json({ msg: "User not found" });

    // 2️⃣ Role-based access
    if (currentUser.role === "user" && currentUser.id !== Number(userId)) {
      return res.status(403).json({ msg: "❌ Access Denied" });
    }
    if (
      currentUser.role === "admin" &&
      user.role !== "user" // admin can see only their users
    ) {
      return res.status(403).json({ msg: "❌ Access Denied" });
    }

    // 3️⃣ Get material accounts
    const flyashAccount = await accountRepo.findOne({
      where: { user: { id: user.id }, materialType: "flyash" },
    });
    const bedashAccount = await accountRepo.findOne({
      where: { user: { id: user.id }, materialType: "bedash" },
    });

    // 4️⃣ Get transaction history
    const transactions = await transactionRepo.find({
      where: { user: { id: user.id } },
      order: { createdAt: "DESC" },
    });

    // 5️⃣ Format transactions
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

    // 6️⃣ Return response
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
