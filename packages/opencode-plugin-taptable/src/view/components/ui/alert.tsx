import type { JSX } from '@solidjs/web';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export type AlertProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'> & {
  variant?: 'default' | 'destructive';
  class?: string;
};

export function Alert(props: AlertProps) {
  const rest = omit(props, 'variant', 'class');
  return (
    <div
      role="alert"
      data-slot="alert"
      {...rest}
      class={cn(
        'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
        props.variant === 'destructive'
          ? 'border-destructive/40 bg-card text-destructive [&_[data-slot=alert-description]]:text-destructive/90'
          : 'bg-card text-card-foreground',
        props.class,
      )}
    />
  );
}

export function AlertTitle(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'> & { class?: string },
) {
  const rest = omit(props, 'class');
  return (
    <div
      data-slot="alert-title"
      {...rest}
      class={cn('col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight', props.class)}
    />
  );
}

export function AlertDescription(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'> & { class?: string },
) {
  const rest = omit(props, 'class');
  return (
    <div
      data-slot="alert-description"
      {...rest}
      class={cn(
        'col-start-2 grid justify-items-start gap-1 text-xs text-muted-foreground [&_p]:leading-relaxed',
        props.class,
      )}
    />
  );
}
