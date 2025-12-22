// Re-export lucide-animated icons (beautifully crafted animated icons)
export { BotIcon as Bot } from '@/components/ui/bot';
export { SparklesIcon as Sparkles } from '@/components/ui/sparkles';
export { UserIcon as User } from '@/components/ui/user';
export { CheckIcon as Check } from '@/components/ui/check';
export { XIcon as X } from '@/components/ui/x';

// For icons not yet in lucide-animated, use lucide-react with motion wrapper
import { motion } from 'motion/react';
import {
  SendHorizontal as SendIcon,
  Loader2 as LoaderIcon,
  Package as PackageIcon,
  Users as UsersIcon,
  Building2 as BuildingIcon,
  Landmark as LandmarkIcon,
  ShoppingBag as ShoppingBagIcon,
  CreditCard as CreditCardIcon,
  PlusCircle as PlusCircleIcon,
  Folder as FolderIcon,
  FileText as FileTextIcon,
  Clipboard as ClipboardIcon,
  Receipt as ReceiptIcon,
  Wrench as WrenchIcon,
  Search as SearchIcon,
  Database as DatabaseIcon,
  Network as NetworkIcon,
  FileSearch as FileSearchIcon,
  Code as CodeIcon,
  AlertCircle as AlertCircleIcon,
  CheckCircle2 as CheckCircle2Icon,
  Info as InfoIcon,
  Calendar as CalendarIcon,
  Mail as MailIcon,
  Phone as PhoneIcon,
  Tag as TagIcon,
  DollarSign as DollarSignIcon,
  BarChart3 as BarChart3Icon,
} from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface IconProps {
  size?: number;
  className?: string;
}

// Send icon with slide animation
export const SendHorizontal = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 18 }, ref) => (
    <motion.div
      ref={ref}
      className={cn('inline-flex', className)}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400 }}
    >
      <SendIcon size={size} />
    </motion.div>
  )
);
SendHorizontal.displayName = 'SendHorizontal';

// Loader with continuous rotation
export const Loader2 = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <motion.div
      ref={ref}
      className={cn('inline-flex', className)}
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
    >
      <LoaderIcon size={size} />
    </motion.div>
  )
);
Loader2.displayName = 'Loader2';

// Quick action icons
export const Package = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 14 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <PackageIcon size={size} />
    </div>
  )
);
Package.displayName = 'Package';

export const Users = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 14 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <UsersIcon size={size} />
    </div>
  )
);
Users.displayName = 'Users';

export const Building2 = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 14 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <BuildingIcon size={size} />
    </div>
  )
);
Building2.displayName = 'Building2';

export const Landmark = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 14 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <LandmarkIcon size={size} />
    </div>
  )
);
Landmark.displayName = 'Landmark';

export const ShoppingBag = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 14 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <ShoppingBagIcon size={size} />
    </div>
  )
);
ShoppingBag.displayName = 'ShoppingBag';

export const CreditCard = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 14 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <CreditCardIcon size={size} />
    </div>
  )
);
CreditCard.displayName = 'CreditCard';

export const PlusCircle = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <motion.div
      ref={ref}
      className={cn('inline-flex', className)}
      whileHover={{ rotate: 90 }}
      transition={{ type: 'spring', stiffness: 300 }}
    >
      <PlusCircleIcon size={size} />
    </motion.div>
  )
);
PlusCircle.displayName = 'PlusCircle';

// Workflow icons with hover animations
export const Folder = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <motion.div
      ref={ref}
      className={cn('inline-flex', className)}
      whileHover={{ scale: 1.1 }}
      transition={{ type: 'spring', stiffness: 300 }}
    >
      <FolderIcon size={size} />
    </motion.div>
  )
);
Folder.displayName = 'Folder';

export const FileText = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <motion.div
      ref={ref}
      className={cn('inline-flex', className)}
      whileHover={{ scale: 1.1 }}
      transition={{ type: 'spring', stiffness: 300 }}
    >
      <FileTextIcon size={size} />
    </motion.div>
  )
);
FileText.displayName = 'FileText';

export const Clipboard = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <motion.div
      ref={ref}
      className={cn('inline-flex', className)}
      whileHover={{ scale: 1.1 }}
      transition={{ type: 'spring', stiffness: 300 }}
    >
      <ClipboardIcon size={size} />
    </motion.div>
  )
);
Clipboard.displayName = 'Clipboard';

export const Receipt = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <motion.div
      ref={ref}
      className={cn('inline-flex', className)}
      whileHover={{ scale: 1.1 }}
      transition={{ type: 'spring', stiffness: 300 }}
    >
      <ReceiptIcon size={size} />
    </motion.div>
  )
);
Receipt.displayName = 'Receipt';

export const Wrench = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <motion.div
      ref={ref}
      className={cn('inline-flex', className)}
      whileHover={{ rotate: 15, scale: 1.1 }}
      transition={{ type: 'spring', stiffness: 300 }}
    >
      <WrenchIcon size={size} />
    </motion.div>
  )
);
Wrench.displayName = 'Wrench';

// Data fetching and search icons
export const Search = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <SearchIcon size={size} />
    </div>
  )
);
Search.displayName = 'Search';

export const Database = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <DatabaseIcon size={size} />
    </div>
  )
);
Database.displayName = 'Database';

export const Network = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <NetworkIcon size={size} />
    </div>
  )
);
Network.displayName = 'Network';

export const FileSearch = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <FileSearchIcon size={size} />
    </div>
  )
);
FileSearch.displayName = 'FileSearch';

export const Code = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <CodeIcon size={size} />
    </div>
  )
);
Code.displayName = 'Code';

export const AlertCircle = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <AlertCircleIcon size={size} />
    </div>
  )
);
AlertCircle.displayName = 'AlertCircle';

export const CheckCircle2 = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <CheckCircle2Icon size={size} />
    </div>
  )
);
CheckCircle2.displayName = 'CheckCircle2';

export const Info = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <InfoIcon size={size} />
    </div>
  )
);
Info.displayName = 'Info';

export const Calendar = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <CalendarIcon size={size} />
    </div>
  )
);
Calendar.displayName = 'Calendar';

export const Mail = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <MailIcon size={size} />
    </div>
  )
);
Mail.displayName = 'Mail';

export const Phone = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <PhoneIcon size={size} />
    </div>
  )
);
Phone.displayName = 'Phone';

export const Tag = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <TagIcon size={size} />
    </div>
  )
);
Tag.displayName = 'Tag';

export const DollarSign = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <DollarSignIcon size={size} />
    </div>
  )
);
DollarSign.displayName = 'DollarSign';

export const BarChart3 = forwardRef<HTMLDivElement, IconProps>(
  ({ className, size = 16 }, ref) => (
    <div ref={ref} className={cn('inline-flex', className)}>
      <BarChart3Icon size={size} />
    </div>
  )
);
BarChart3.displayName = 'BarChart3';
