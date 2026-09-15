import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from "typeorm";
import { User } from "./User";

// Helper function to maintain consistency with Token & MaterialAccount
const numericTransformer = {
  to: (data: number) => data,
  from: (data: string) => parseFloat(data),
};

@Entity()
export class BedashMessage {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, (user) => user.bedashMessages, { onDelete: "CASCADE" })
  user!: User;

  // 🛠️ Type string ko first argument bana diya taaki overload error na aaye
  @Column("numeric", {
    precision: 12,
    scale: 3,
    default: 0,
    transformer: numericTransformer,
  })
  amount!: number;

  @Column("varchar", { default: "bedash" })
  materialType!: "flyash" | "bedash";

  @Column("date", { nullable: true })
  customDate!: Date | null;

  @Index() // ⚡ Fast sorting ke liye alag se Index decorator laga diya
  @Column("date", { nullable: true })
  targetDate!: Date | null;

  @Index()
  @Column("varchar", { default: "pending" })
  status!: "pending" | "completed";

  @Column("varchar", { nullable: true })
  reminderPhone!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => User, (user) => user.createdBedash, { onDelete: "CASCADE" })
  createdBy!: User;
}