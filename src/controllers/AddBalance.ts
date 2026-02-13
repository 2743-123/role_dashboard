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

export const getAllUsersBalanceReport = async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;

    // 1️⃣ Only admin / superadmin allowed
    if (currentUser.role === "user") {
      return res.status(403).json({ msg: "❌ Access denied" });
    }

    let users: User[] = [];

    // 2️⃣ Superadmin → all users
    if (currentUser.role === "superadmin") {
      users = await userRepo.find({
        where: { role: "user" },
        order: { name: "ASC" },
      });
    }

    // 3️⃣ Admin → only their created users
    else if (currentUser.role === "admin") {
      users = await userRepo.find({
        where: {
          role: "user",
          createdBy: currentUser.id, // ✅ correct filter
        },
        order: { name: "ASC" },
      });
    }

    const report = [];

    // 4️⃣ Loop through users
    for (const user of users) {
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

      report.push({
        userId: user.id,
        userName: user.name,

        flyash: {
          total: flyashAccount
            ? Number(flyashAccount.totalTons).toFixed(3)
            : "0.000",
          used: flyashAccount
            ? Number(flyashAccount.usedTons).toFixed(3)
            : "0.000",
          remaining: flyashAccount
            ? Number(flyashAccount.remainingTons).toFixed(3)
            : "0.000",
        },

        bedash: {
          total: bedashAccount
            ? Number(bedashAccount.totalTons).toFixed(3)
            : "0.000",
          used: bedashAccount
            ? Number(bedashAccount.usedTons).toFixed(3)
            : "0.000",
          remaining: bedashAccount
            ? Number(bedashAccount.remainingTons).toFixed(3)
            : "0.000",
        },

        ratePerTon: 180,

        transactions: transactions.map((tx) => ({
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
      });
    }

    // 5️⃣ Response
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

export const editBalance = async (req: Request, res: Response) => {
  try {
    const { transactionId, flyashAmount = 0, bedashAmount = 0 } = req.body;
    const currentUser = req.user!;

    const transaction = await transactionRepo.findOne({
      where: { id: transactionId },
      relations: ["user"],
    });

    if (!transaction) return res.status(404).json({ msg: "Transaction not found" });

    if (currentUser.role === "user")
      return res.status(403).json({ msg: "❌ Access denied" });

    /** accounts */
    const flyashAccount = await accountRepo.findOne({
      where: { user: { id: transaction.user.id }, materialType: "flyash" },
    });

    const bedashAccount = await accountRepo.findOne({
      where: { user: { id: transaction.user.id }, materialType: "bedash" },
    });

    if (!flyashAccount || !bedashAccount)
      return res.status(400).json({ msg: "Material account missing" });

    /** old tons */
    const oldFlyashTons = transaction.flyashTons;
    const oldBedashTons = transaction.bedashTons;

    /** new tons */
    const newFlyashTons = flyashAmount / RATE_PER_TON;
    const newBedashTons = bedashAmount / RATE_PER_TON;

    /** remaining safety */
    if (flyashAccount.remainingTons + oldFlyashTons < newFlyashTons)
      return res.status(400).json({ msg: "❌ Flyash already used. Can't reduce." });

    if (bedashAccount.remainingTons + oldBedashTons < newBedashTons)
      return res.status(400).json({ msg: "❌ Bedash already used. Can't reduce." });

    /** update accounts */
    flyashAccount.totalTons = flyashAccount.totalTons - oldFlyashTons + newFlyashTons;
    flyashAccount.remainingTons =
      flyashAccount.remainingTons - oldFlyashTons + newFlyashTons;

    bedashAccount.totalTons = bedashAccount.totalTons - oldBedashTons + newBedashTons;
    bedashAccount.remainingTons =
      bedashAccount.remainingTons - oldBedashTons + newBedashTons;

    await accountRepo.save([flyashAccount, bedashAccount]);

    /** update transaction */
    transaction.flyashAmount = flyashAmount;
    transaction.bedashAmount = bedashAmount;
    transaction.totalAmount = flyashAmount + bedashAmount;
    transaction.flyashTons = newFlyashTons;
    transaction.bedashTons = newBedashTons;

    await transactionRepo.save(transaction);

    return res.json({ msg: "✅ Balance updated successfully", data: transaction });
  } catch (error) {
    console.error("Edit balance error:", error);
    return res.status(500).json({ msg: "Server error" });
  }
};

export const deleteBalance = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;
    const currentUser = req.user!;

    const transaction = await transactionRepo.findOne({
      where: { id: Number(transactionId) },
      relations: ["user"],
    });

    if (!transaction)
      return res.status(404).json({ msg: "Transaction not found" });

    if (currentUser.role === "user")
      return res.status(403).json({ msg: "❌ Access denied" });

    /** 🔹 get latest transaction of this user */
    const lastTransaction = await transactionRepo.findOne({
      where: { user: { id: transaction.user.id } },
      order: { id: "DESC" },
    });

    /** ❌ only last transaction can be deleted */
    if (!lastTransaction || lastTransaction.id !== transaction.id) {
      return res.status(400).json({
        msg: "❌ Only latest balance entry can be deleted",
      });
    }

    const flyashAccount = await accountRepo.findOne({
      where: { user: { id: transaction.user.id }, materialType: "flyash" },
    });

    const bedashAccount = await accountRepo.findOne({
      where: { user: { id: transaction.user.id }, materialType: "bedash" },
    });

    if (!flyashAccount || !bedashAccount)
      return res.status(400).json({ msg: "Material account missing" });

    /** 🔹 check unused tons */
    if (flyashAccount.remainingTons < transaction.flyashTons) {
      return res.status(400).json({
        msg: "❌ Flyash already used. Can't delete balance.",
      });
    }

    if (bedashAccount.remainingTons < transaction.bedashTons) {
      return res.status(400).json({
        msg: "❌ Bedash already used. Can't delete balance.",
      });
    }

    /** 🔹 subtract tons */
    flyashAccount.totalTons -= transaction.flyashTons;
    flyashAccount.remainingTons -= transaction.flyashTons;

    bedashAccount.totalTons -= transaction.bedashTons;
    bedashAccount.remainingTons -= transaction.bedashTons;

    await accountRepo.save([flyashAccount, bedashAccount]);

    /** 🔹 delete transaction */
    await transactionRepo.remove(transaction);

    return res.json({ msg: "🗑️ Balance deleted successfully" });
  } catch (error) {
    console.error("Delete balance error:", error);
    return res.status(500).json({ msg: "Server error" });
  }
};

