import {
  Tabs as UiTabs,
  TabsList as UiTabsList,
  TabsPanel as UiTabsPanel,
  TabsTab as UiTabsTab,
} from '@ui-sdk/solid/tabs';
import type { ComponentProps } from 'solid-js';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export const Tabs = UiTabs;
export const TabsPanel = UiTabsPanel;

export type TabsListProps = Omit<ComponentProps<typeof UiTabsList>, 'class'> & {
  class?: string;
};

export function TabsList(props: TabsListProps) {
  const rest = omit(props, 'class');
  return (
    <UiTabsList
      {...rest}
      class={cn(
        'inline-flex h-8 w-fit items-center justify-center rounded-md bg-muted p-[3px] text-muted-foreground',
        props.class,
      )}
    />
  );
}

export type TabsTriggerProps = Omit<ComponentProps<typeof UiTabsTab>, 'class'> & {
  class?: string;
};

export function TabsTrigger(props: TabsTriggerProps) {
  const rest = omit(props, 'class');
  return (
    <UiTabsTab
      {...rest}
      class={cn(
        'inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1 rounded-sm border border-transparent px-2 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground transition-[color,box-shadow,background-color] outline-none select-none hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-selected:bg-background data-selected:text-foreground data-selected:shadow-xs',
        props.class,
      )}
    />
  );
}
