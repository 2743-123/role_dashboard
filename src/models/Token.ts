import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Index,
} from "typeorm";
import { User } from "./User";

// Helper function: DB numbers string ban kar aate hain, unhe waapis JS Number me badalne ke liye
const numericTransformer = {
  to: (data: number) => data,
  from: (data: string) => parseFloat(data),
};

@Entity()
export class Token {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column("varchar")
  customerName!: string;

  @Index()
  @Column("varchar", { nullable: true })
  truckNumber!: string;

  @Index()
  @Column("varchar")
  materialType!: "flyash" | "bedash";

  // ==========================================
  // 🟢 BEDASH SPECIFIC FIELDS (Naye Add Kiye)
  // ==========================================
  @Index()
  @Column("varchar", { nullable: true })
  cartingOwnerName!: string | null;

  @Column("varchar", { length: 15, nullable: true })
  cartingOwnerPhone!: string | null;

  @Column("varchar", { default: "owner" }) // "owner" | "another"
  tokenOwnerType!: "owner" | "another";

  @Index()
  @Column("varchar", { nullable: true })
  anotherTokenOwnerName!: string | null;

  @Column("varchar", { length: 15, nullable: true })
  anotherTokenOwnerPhone!: string | null;

  // ==========================================
  // 🟢 RATES & AMOUNTS (BEDASH MATH)
  // ==========================================
  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  sellRate!: number; // Customer ko jo rate diya

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  cartingRate!: number; // Carting wale ka rate

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  totalCarting!: number; // cartingRate * weight

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  tokenOwnerRate!: number; // Another owner ka rate

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  totalTokenOwnerAmount!: number; // tokenOwnerRate * weight

  // ==========================================
  // 🟢 PAYMENTS & CARRY FORWARD (TRIPLE LEDGER)
  // ==========================================
  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  cartingPaidAmount!: number;

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  cartingCarryForward!: number; 

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  tokenOwnerPaidAmount!: number;

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  tokenOwnerCarryForward!: number; 

  // Standard Fields
  @Column("numeric", { precision: 12, scale: 3, default: 0, transformer: numericTransformer })
  weight!: number; 

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  ratePerTon!: number; // Flyash ke liye

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  commission!: number;

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  totalAmount!: number; // Total Customer Bill

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  paidAmount!: number; // Customer ne kitna pay kiya

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  carryForward!: number; // Customer Ledger

  @Index()
  @Column("varchar", { default: "pending" })
  status!: "pending" | "updated" | "completed";

  @Index()
  @CreateDateColumn()
  createdAt!: Date;

  @Column("timestamp", { nullable: true })
  updatedAt!: Date | null;

  @Column("timestamp", { nullable: true })
  confirmedAt!: Date | null;

  @Index()
  @Column("varchar", { length: 15, nullable: true })
  customerPhone!: string;

  @ManyToOne(() => User, (user) => user.tokens, {
    onDelete: "CASCADE", 
    onUpdate: "CASCADE",
  })
  user!: User;
}