// OCI Design System — entry point.
//
// Tone: calm, clinical, forward-looking. Built on Tailwind CSS v4 design
// tokens (declared in apps/web/src/app/globals.css under @theme) plus
// CVA-based primitives. No Radix dependency yet — components added here
// are pure DOM + Tailwind. Complex primitives that need accessibility
// orchestration (Dialog, DropdownMenu, Combobox) will pull @radix-ui/*
// when introduced.

export { cn } from './lib/cn.js';

export { Button, buttonVariants, type ButtonProps } from './components/button.js';
export { IconButton, type IconButtonProps } from './components/icon-button.js';
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  type CardProps,
} from './components/card.js';
export { Badge, type BadgeProps } from './components/badge.js';
export { Alert, AlertTitle, AlertDescription, type AlertProps } from './components/alert.js';
export { Separator, type SeparatorProps } from './components/separator.js';
export {
  DefinitionList,
  DefinitionItem,
  type DefinitionItemProps,
} from './components/definition-list.js';
export { Input, Textarea, type InputProps, type TextareaProps } from './components/input.js';
export { Field, type FieldProps } from './components/field.js';
export {
  Container,
  Section,
  type ContainerProps,
  type SectionProps,
} from './components/container.js';
export { Stat, type StatProps } from './components/stat.js';
export {
  SearchIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  ExternalLinkIcon,
  CheckIcon,
  InfoIcon,
  AlertIcon,
  DatabaseIcon,
  ShieldIcon,
  SparkIcon,
  FlowIcon,
  ChartIcon,
  FileTextIcon,
  UserIcon,
  KeyIcon,
  GlobeIcon,
  ClockIcon,
} from './components/icon.js';
