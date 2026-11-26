import {
  Menu as UiMenu,
  MenuContent as UiMenuContent,
  MenuItem as UiMenuItem,
  MenuTrigger as UiMenuTrigger,
} from '@ui-sdk/solid/menu';
import type { ComponentProps } from 'solid-js';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export const DropdownMenu = UiMenu;
export const DropdownMenuTrigger = UiMenuTrigger;

export type DropdownMenuContentProps = Omit<ComponentProps<typeof UiMenuContent>, 'class'> & {
  class?: string;
};

export function DropdownMenuContent(props: DropdownMenuContentProps) {
  const rest = omit(props, 'class');
  return (
    <UiMenuContent
      sideOffset={4}
      {...rest}
      class={cn(
        'z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none origin-(--transform-origin) transition-[opacity,scale] duration-120 data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0',
        props.class,
      )}
    />
  );
}

export type DropdownMenuItemProps = Omit<ComponentProps<typeof UiMenuItem>, 'class'> & {
  class?: string;
};

export function DropdownMenuItem(props: DropdownMenuItemProps) {
  const rest = omit(props, 'class');
  return (
    <UiMenuItem
      {...rest}
      class={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none select-none transition-colors data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        props.class,
      )}
    />
  );
}
