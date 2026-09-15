import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { MaterialAccount } from "./materialaccount";
import { Token } from "./Token";
import { Transaction } from "./Transaction";
import { BedashMessage } from "./bedashMessage";

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  // ⚡ Index: Name se search fast karne ke liye
  @Index()
  @Column("varchar", { default: "Unknown" })
  name!: string;

  // ⚡ unique: true automatically ek Index bana deta hai fast login ke liye
  @Column("varchar", { unique: true })
  email!: string;

  @Column("varchar")
  password!: string;

  // ⭐ NAYA COLUMN: Dealer/User ka WhatsApp number save karne ke liye
  // ⚡ Index: Phone number se search aur login fast hoga
  @Index()
  @Column("varchar", { length: 15, nullable: true })
  phone!: string;

  // ⚡ Index: Sirf "admin" ya sirf "user" ko filter karke nikalna ab microseconds me hoga
  @Index()
  @Column("varchar", { default: "user" }) // user | admin | superadmin
  role!: string;

  // ⚡ Index: Dashboard me sirf Active users (isActive: true) dikhane ke liye
  @Index()
  @Column("boolean", { default: true })
  isActive!: boolean;

  @Index()
  @CreateDateColumn()
  createdAt!: Date;

  @Column("varchar", { nullable: true })
  whatsappInstanceId!: string;

  @Column("varchar", { nullable: true })
  whatsappToken!: string;

  @OneToMany(() => MaterialAccount, (account) => account.user)
  accounts!: MaterialAccount[];

  @OneToMany(() => Token, (token) => token.user)
  tokens!: Token[];

  @OneToMany(() => Transaction, (transaction) => transaction.user)
  transactions!: Transaction[];

  @OneToMany(() => BedashMessage, (msg) => msg.user)
  bedashMessages!: BedashMessage[];

  // ✅ SIRF RELATION RAKHNA HAI (Explicit Column hata diya gaya hai)
  @ManyToOne(() => User, (user) => user.children, {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "createdBy" }) 
  creator?: User;

  @OneToMany(() => User, (user) => user.creator)
  children!: User[];

  @OneToMany(() => BedashMessage, (bedash) => bedash.createdBy)
  createdBedash!: BedashMessage[];
}