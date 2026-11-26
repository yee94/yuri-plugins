import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipTrigger as UiTooltipTrigger,
} from '@ui-sdk/solid/tooltip';
import type { ComponentProps } from 'solid-js';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export const Tooltip = UiTooltip;
export const TooltipTrigger = UiTooltipTrigger;

export type TooltipContentProps = Omit<ComponentProps<typeof UiTooltipContent>, 'class'> & {
  class?: string;
};

export function TooltipContent(props: TooltipContentProps) {
  const rest = omit(props, 'class');
  return (
    <UiTooltipContent
      sideOffset={6}
      {...rest}
      class={cn(
        'z-50 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground shadow-md outline-none origin-(--transform-origin) transition-[opacity,scale] duration-120 data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0',
        props.class,
      )}
    />
  );
}
