import { AppDataSource } from "../../config/db";
import { Token } from "../../models/Token";
import { MaterialAccount } from "../../models/materialaccount";
import { checkPermission, findUser } from "../../utils/aiHelpers";

const tokenRepo = AppDataSource.getRepository(Token);
const accountRepo = AppDataSource.getRepository(MaterialAccount);
const RATE_PER_TON = 180;

export const tokenService = {
  createToken: async (params: any, targetUserName: string, currentUser: any) => {
    let user = await findUser(targetUserName); 
    let finalCustomerName = params.customerName || "";
    if (!user && finalCustomerName) { 
      const checkOtherName = await findUser(finalCustomerName); 
      if (checkOtherName) { user = checkOtherName; finalCustomerName = targetUserName; } 
    }
    if (!user) return { msg: "🤖 System me dealer ka naam nahi mila." };
    if (!checkPermission(currentUser, user)) return { msg: "🚫 Permission Denied." };
    finalCustomerName = finalCustomerName || "Walk-in";
    const adminId = user.role === "user" ? user.creator?.id : user.id;
    const lastToken = await tokenRepo.createQueryBuilder("t").leftJoin("t.user", "u").leftJoin("u.creator", "c").where("t.customerName = :cName", { cName: finalCustomerName }).andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId }).orderBy("t.id", "DESC").getOne();
    const newToken = tokenRepo.create({ customerName: finalCustomerName, customerPhone: params.customerPhone || null, user: user, truckNumber: params.truckNumber || null, materialType: params.materialType || "flyash", weight: 0, commission: 0, totalAmount: 0, paidAmount: 0, status: "pending", carryForward: lastToken ? Number(lastToken.carryForward || 0) : 0, });
    await tokenRepo.save(newToken);
    return { msg: `✅ Token #${newToken.id} created successfully for Customer: *${newToken.customerName}* (Dealer: *${user.name}*).` };
  },

  deleteToken: async (params: any, targetUserName: string, currentUser: any) => {
    let user = await findUser(targetUserName); let finalCustomerName = params.customerName || "";
    if (!user && finalCustomerName) { const checkOtherName = await findUser(finalCustomerName); if (checkOtherName) { user = checkOtherName; finalCustomerName = targetUserName; } }
    if (!user) return { msg: "🤖 System me dealer (User) ka naam nahi mila." };
    if (!finalCustomerName) return { msg: "🤖 Kripya Customer ka naam batayein." };
    if (!checkPermission(currentUser, user)) return { msg: "🚫 Permission Denied." };
    const tokenToDelete = await tokenRepo.findOne({ where: { user: { id: user.id }, customerName: finalCustomerName, status: "pending" }, order: { id: "DESC" } });
    if (!tokenToDelete) return { msg: `🤖 Dealer *${user.name}* ke account me Customer *${finalCustomerName}* ki koi PENDING token nahi mili.` };
    const deletedId = tokenToDelete.id; await tokenRepo.remove(tokenToDelete);
    return { msg: `✅ Customer *${finalCustomerName}* ki aakhri pending Token (ID: #${deletedId}) successfully delete kar di gayi hai.` };
  },

  updateToken: async (params: any, targetUserName: string, currentUser: any) => {
    let user = await findUser(targetUserName); 
    let finalCustomerName = params.customerName || "";
    
    if (!user && finalCustomerName) { 
      const checkOtherName = await findUser(finalCustomerName); 
      if (checkOtherName) { user = checkOtherName; finalCustomerName = targetUserName; } 
    }
    
    if (!user) return { msg: "🤖 System me dealer ka naam nahi mila." };
    if (!finalCustomerName) return { msg: "🤖 Kripya Customer ka naam batayein." };
    // if (!checkPermission(currentUser, user)) return { msg: "🚫 Permission Denied." };

    // ✅ Naya Parameter: position ("first" ya "last")
    const { searchDate, searchTruckNumber, searchWeight, newTruckNumber, newWeight, newCommission, newDate, position } = params;
    
    let query = tokenRepo.createQueryBuilder("t")
      .leftJoinAndSelect("t.user", "u")
      .where("u.id = :userId", { userId: user.id })
      .andWhere("t.customerName ILIKE :cName", { cName: `%${finalCustomerName}%` }); // Case insensitive search

    let hasSearchParams = false;
    if (searchTruckNumber) { query = query.andWhere("t.truckNumber ILIKE :sTruck", { sTruck: `%${searchTruckNumber}%` }); hasSearchParams = true; }
    if (searchWeight) { query = query.andWhere("CAST(t.weight AS TEXT) = :sWeight", { sWeight: String(searchWeight) }); hasSearchParams = true; }
    if (searchDate) { query = query.andWhere("CAST(t.updatedAt AS TEXT) ILIKE :sDate", { sDate: `${searchDate}%` }); hasSearchParams = true; }

    let tokensFound: Token[] = [];
    if (hasSearchParams) { 
      tokensFound = await query.orderBy("t.id", "DESC").getMany(); 
    } else { 
      const absoluteLatest = await query.orderBy("t.id", "DESC").getOne(); 
      if (absoluteLatest) tokensFound = [absoluteLatest]; 
    }

    if (tokensFound.length === 0) return { msg: `🤖 Dealer *${user.name}* ki Customer *${finalCustomerName}* ke liye koi matching token nahi mili.` };
    
    let tokenToUpdate: Token;

    // 🚀 MULTIPLE TOKENS CONFLICT RESOLUTION
    if (tokensFound.length > 1) {
      if (position === "first" || position === "pahli") {
        // DESC order me sabse aakhri element sabse purana (first) hoga
        tokenToUpdate = tokensFound[tokensFound.length - 1]; 
      } else if (position === "last" || position === "aakhri") {
        // DESC order me pehla element sabse naya (last) hoga
        tokenToUpdate = tokensFound[0]; 
      } else {
        return { msg: `🤖 Is criteria par mujhe **${tokensFound.length} tokens** mili hain! Kripya command me likhein ki aapko **'pahli'** (first) wali update karni hai ya **'aakhri'** (latest) wali.` };
      }
    } else {
      tokenToUpdate = tokensFound[0];
    }

    const account = await accountRepo.findOne({ where: { user: { id: user.id }, materialType: tokenToUpdate.materialType } });
    const oldWeight = Number(tokenToUpdate.weight || 0);
    let finalNewWeight = oldWeight;
    if (newWeight !== undefined && newWeight !== null && newWeight !== "") finalNewWeight = Number(newWeight);
    const diff = finalNewWeight - oldWeight;

    if (diff > 0 && account && diff > Number(account.remainingTons)) return { msg: `🤖 Stock kam hai! Aapke paas sirf ${account.remainingTons} Tons bache hain.` };

    if (newTruckNumber) tokenToUpdate.truckNumber = newTruckNumber;
    tokenToUpdate.weight = finalNewWeight;
    if (newCommission !== undefined && newCommission !== null && newCommission !== "") tokenToUpdate.commission = Number(newCommission);
    
    const rateToUse = tokenToUpdate.ratePerTon || RATE_PER_TON;
    tokenToUpdate.totalAmount = (finalNewWeight * rateToUse) + Number(tokenToUpdate.commission || 0);
    if (newDate) tokenToUpdate.updatedAt = new Date(newDate);
    else if (tokenToUpdate.status === "pending") tokenToUpdate.updatedAt = new Date();

    await tokenRepo.save(tokenToUpdate);

    if (account) {
      const allTokensForStock = await tokenRepo.find({ where: { user: { id: user.id }, materialType: tokenToUpdate.materialType } });
      let exactUsedTons = 0;
      allTokensForStock.forEach(t => { exactUsedTons += Number(t.weight || 0); });
      account.usedTons = exactUsedTons;
      account.remainingTons = Number(account.totalTons) - exactUsedTons;
      await accountRepo.save(account);
    }

    const adminId = user.role === "user" ? user.creator?.id : user.id;
    const prevTokenBeforeCurrent = await tokenRepo.createQueryBuilder("t").leftJoin("t.user", "u").leftJoin("u.creator", "c").where("t.customerName ILIKE :cName", { cName: `%${finalCustomerName}%` }).andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId }).andWhere("t.id < :id", { id: tokenToUpdate.id }).orderBy("t.id", "DESC").getOne();
    let runningCarry = prevTokenBeforeCurrent ? Number(prevTokenBeforeCurrent.carryForward || 0) : 0;
    const allRelevantTokens = await tokenRepo.createQueryBuilder("t").leftJoinAndSelect("t.user", "u").where("t.customerName ILIKE :cName", { cName: `%${finalCustomerName}%` }).andWhere("t.id >= :id", { id: tokenToUpdate.id }).orderBy("t.id", "ASC").getMany();
    const tokensToSave = allRelevantTokens.map(t => t.id === tokenToUpdate.id ? tokenToUpdate : t);

    for (const t of tokensToSave) {
      const tTotal = Number(t.totalAmount || 0);
      const tPaid = Number(t.paidAmount || 0);
      runningCarry = Number((runningCarry + tPaid - tTotal).toFixed(2));
      t.carryForward = runningCarry;
      if (tTotal > 0 && t.status === "pending") t.status = "updated";
    }
    await tokenRepo.save(tokensToSave);
    
    return { msg: `✅ Token #${tokenToUpdate.id} successfully update ho gaya!\n\n🚛 Truck: ${tokenToUpdate.truckNumber || "N/A"}\n⚖️ Weight: ${tokenToUpdate.weight} Tons\n💰 Commission: ₹${tokenToUpdate.commission || 0}\n💵 Total Bill: ₹${tokenToUpdate.totalAmount}` };
  },

  reportUserTokens: async (targetUserName: string, currentUser: any) => {
    const user = await findUser(targetUserName);
    if (!user) return { msg: "🤖 User/Dealer ka naam nahi mila." };
    if (!checkPermission(currentUser, user)) return { msg: "🚫 Permission Denied." };
    const tokens = await tokenRepo.find({ where: { user: { id: user.id } } });
    let pendingCount = 0; let updatedCount = 0; let completedCount = 0; let totalDue = 0;
    tokens.forEach(t => {
      if (t.status === "pending") pendingCount++;
      if (t.status === "updated") { updatedCount++; totalDue += (Number(t.totalAmount || 0) - Number(t.paidAmount || 0)); }
      if (t.status === "completed") completedCount++;
    });
    return { msg: `🤖 **Dealer: ${user.name}**\n\n⏳ Pending Tokens: ${pendingCount}\n✅ Updated (Baaki): ${updatedCount}\n💯 Confirm (Paid): ${completedCount}\n💵 Market Se Lene Hain (Dues): **₹${totalDue}**` };
  },

reportCustomer: async (params: any, currentUser: any) => {
    const customerName = params.customerName;

    // Admin apne khud ke aur apne dealers (users) dono ke customers dekh sakta hai
    let tQuery = tokenRepo.createQueryBuilder("t")
      .leftJoinAndSelect("t.user", "u")
      .leftJoin("u.creator", "c");

    if (currentUser.role === "admin") {
      tQuery.where("(c.id = :adminId OR u.id = :adminId)", { adminId: currentUser.id });
    } else if (currentUser.role === "user") {
      tQuery.where("u.id = :userId", { userId: currentUser.id });
    }

    if (customerName) {
      tQuery.andWhere("t.customerName ILIKE :cName", { cName: `%${customerName}%` });
    }

    // Saari tokens ko chronological order me nikalna zaroori hai (FIFO carry forward ke liye)
    const tokens = await tQuery.orderBy("t.id", "ASC").getMany();

    if (tokens.length === 0) {
      return { msg: customerName ? `🤖 Customer *${customerName}* ki koi token system me nahi hai.` : "🤖 Aapke under abhi koi customer data nahi hai." };
    }

    // Customer-wise grouping
    const customerMap = new Map();

    tokens.forEach(t => {
      const cName = t.customerName.toUpperCase();
      if (!customerMap.has(cName)) {
        customerMap.set(cName, {
          pendingCount: 0,
          updatedCount: 0,
          completedCount: 0,
          latestCarryForward: 0,
          activeTokens: [] // Truck/Weight details ke liye
        });
      }

      const cData = customerMap.get(cName);
      if (t.status === "pending") cData.pendingCount++;
      if (t.status === "updated") cData.updatedCount++;
      if (t.status === "completed") cData.completedCount++;
      
      // Har token par update hoga, aakhri me Latest Carry Forward milega
      cData.latestCarryForward = Number(t.carryForward || 0);

      // Sirf baaki (unpaid) tokens ko detailed list me daalenge
      if (t.status === "pending" || t.status === "updated") {
          cData.activeTokens.push(t);
      }
    });

    let finalMsg = `🤖 Hello **${currentUser.name}**,\n\n`;

    // 📌 SCENARIO 1: Agar ek specific customer ka naam pucha gaya hai
    if (customerName) {
      const cData = customerMap.get(customerName.toUpperCase());
      if (!cData) return { msg: `🤖 Customer *${customerName}* ka koi data nahi mila.` };

      const carryText = cData.latestCarryForward < 0 
        ? `-₹${Math.abs(cData.latestCarryForward)} (Lene Baaki Hain)` 
        : `+₹${cData.latestCarryForward} (Advance Jama Hai)`;
      
      finalMsg += `**Customer Report: ${customerName.toUpperCase()}**\n`;
      finalMsg += `💵 Total Market Dues: **${carryText}**\n`;
      finalMsg += `📊 Status: ${cData.pendingCount} Pending | ${cData.updatedCount} Updated | ${cData.completedCount} Paid\n\n`;
      
      if (cData.activeTokens.length > 0) {
        finalMsg += `📋 **Active Tokens Details:**\n`;
        cData.activeTokens.forEach((t: any) => {
          finalMsg += `🚛 Truck: ${t.truckNumber || "N/A"} | Wt: ${t.weight}T | Comm: ₹${t.commission || 0} | Bill: ₹${t.totalAmount || 0} [${t.status.toUpperCase()}]\n`;
        });
      } else {
        finalMsg += `✅ Sabhi tokens clear hain. Koi due/pending truck nahi hai.`;
      }
    } 
    // 📌 SCENARIO 2: "Mere sabhi customers ki due report do" (Bina naam ke pucha)
    else {
      let totalMarketDues = 0;
      let customersWithDues = 0;

      finalMsg += `**Market Dues Report (All Customers):**\n\n`;

      customerMap.forEach((cData, cName) => {
        // Unhi customers ko list karo jinpar udhari hai (carryForward < 0) ya jinunki koi token pending/updated hai
        if (cData.latestCarryForward < 0 || cData.activeTokens.length > 0) {
          customersWithDues++;
          const dueAmount = cData.latestCarryForward < 0 ? Math.abs(cData.latestCarryForward) : 0;
          totalMarketDues += dueAmount;
          
          finalMsg += `👤 **${cName}** | Lene Baaki: **₹${dueAmount}**\n`;
          
          if (cData.activeTokens.length > 0) {
            cData.activeTokens.forEach((t: any) => {
              finalMsg += `   ↳ 🚛 ${t.truckNumber || "N/A"} | Wt: ${t.weight}T | Comm: ₹${t.commission || 0} [${t.status.toUpperCase()}]\n`;
            });
          }
          finalMsg += `\n`; // Ek line ka gap har customer ke baad
        }
      });

      if (customersWithDues === 0) {
        finalMsg += `✅ Market me kisi customer par koi udhari ya baaki truck nahi hai!`;
      } else {
        finalMsg += `🚨 **TOTAL MARKET SE LENE HAIN: ₹${totalMarketDues}**`;
      }
    }

    return { msg: finalMsg };
  }}