import { Button as UiButton } from '@ui-sdk/solid/button';
import type { ComponentProps } from 'solid-js';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export type ButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'default' | 'icon';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
  outline:
    'border border-border bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
  ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 rounded-md px-2.5 text-xs',
  default: 'h-8 gap-2 rounded-md px-3.5 text-xs',
  icon: 'h-8 w-8 rounded-md p-0',
};

export type ButtonProps = Omit<ComponentProps<typeof UiButton>, 'class'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
};

export function Button(props: ButtonProps) {
  const rest = omit(props, 'variant', 'size', 'class');
  return (
    <UiButton
      {...rest}
      class={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap font-medium transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-pending:pointer-events-none data-pending:opacity-60',
        VARIANT_CLASSES[props.variant ?? 'default'],
        SIZE_CLASSES[props.size ?? 'default'],
        props.class,
      )}
    />
  );
}
