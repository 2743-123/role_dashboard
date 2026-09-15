import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from "typeorm";
import { User } from "./User";

// Helper function to safely convert DB numeric strings to JS numbers
const numericTransformer = {
  to: (data: number) => data, // Save as is to DB
  from: (data: string) => parseFloat(data), // Convert string to number when fetching
};

@Entity()
export class Transaction {
  @PrimaryGeneratedColumn()
  id!: number;

  // Relationship with User
  @ManyToOne(() => User, (user) => user.transactions, { onDelete: "CASCADE" })
  user!: User;

  // 🛠️ Type Fix: numeric ko pehla argument banaya
  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  totalAmount!: number;

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  flyashAmount!: number;

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  bedashAmount!: number;

  @Column("numeric", { precision: 12, scale: 3, default: 0, transformer: numericTransformer })
  flyashTons!: number;

  @Column("numeric", { precision: 12, scale: 3, default: 0, transformer: numericTransformer })
  bedashTons!: number;

  // ⚡ Index & Type Fix: Overload error hataya aur fast filter ke liye index lagaya
  @Index()
  @Column("varchar", { default: "cash" })
  paymentMode!: "cash" | "online";

  // Optional fields for extra payment details
  @Column("varchar", { length: 100, nullable: true })
  bankName!: string | null;

  @Column("varchar", { length: 100, nullable: true })
  accountHolder!: string | null;

  // ⚡ Index: Reference number / UTR number se transaction dhoondhna ekdam fast hoga
  @Index()
  @Column("varchar", { length: 100, nullable: true })
  referenceNumber!: string | null;

  // ⚡ Index: Date-wise reports nikalne ke liye index lagaya
  @Index()
  @CreateDateColumn()
  createdAt!: Date;
}