import type { JSX } from '@solidjs/web';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export function Skeleton(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'> & { class?: string },
) {
  const rest = omit(props, 'class');
  return (
    <div
      data-slot="skeleton"
      {...rest}
      class={cn('animate-pulse rounded-md bg-accent', props.class)}
    />
  );
}
