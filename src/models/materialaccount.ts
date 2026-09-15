import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import { User } from "./User";

// Helper function to maintain consistency with Token & Transaction entities
const numericTransformer = {
  to: (data: number) => data,
  from: (data: string) => parseFloat(data),
};

@Entity()
export class MaterialAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  // ⚡ Index lagaya taaki User ke "flyash" ya "bedash" account ki search fast ho jaye
  // 🛠️ Overload error bypass karne ke liye "varchar" ko pehla argument banaya
  @Index()
  @Column("varchar", { 
    default: "flyash",
    nullable: true // 🛡️ Database safety (purane records error na dein)
  })
  materialType!: "flyash" | "bedash";

  // 🛠️ "numeric" ko pehla argument banaya
  @Column("numeric", {
    precision: 12,
    scale: 3,
    default: 0,
    transformer: numericTransformer,
  })
  totalTons!: number;

  @Column("numeric", {
    precision: 12,
    scale: 3,
    default: 0,
    transformer: numericTransformer,
  })
  usedTons!: number;

  @Column("numeric", {
    precision: 12,
    scale: 3,
    default: 0,
    transformer: numericTransformer,
  })
  remainingTons!: number;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToOne(() => User, (user) => user.accounts, { onDelete: "CASCADE" })
  user!: User;
}