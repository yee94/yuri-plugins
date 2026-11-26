import type { JSX } from '@solidjs/web';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'brand';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  outline: 'border border-border bg-transparent text-muted-foreground',
  brand: 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
};

export type BadgeProps = Omit<JSX.HTMLAttributes<HTMLSpanElement>, 'class'> & {
  variant?: BadgeVariant;
  class?: string;
};

export function Badge(props: BadgeProps) {
  const rest = omit(props, 'variant', 'class');
  return (
    <span
      {...rest}
      class={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        VARIANT_CLASSES[props.variant ?? 'secondary'],
        props.class,
      )}
    />
  );
}
