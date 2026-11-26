import {
  Dialog as UiDialog,
  DialogBackdrop as UiDialogBackdrop,
  DialogClose as UiDialogClose,
  DialogContent as UiDialogContent,
  DialogDescription as UiDialogDescription,
  DialogTitle as UiDialogTitle,
  DialogTrigger as UiDialogTrigger,
} from '@ui-sdk/solid/dialog';
import type { JSX } from '@solidjs/web';
import type { ComponentProps } from 'solid-js';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';
import { XIcon } from '../icons';

export const Dialog = UiDialog;
export const DialogTrigger = UiDialogTrigger;
export const DialogClose = UiDialogClose;

export type DialogBackdropProps = Omit<ComponentProps<typeof UiDialogBackdrop>, 'class'> & {
  class?: string;
};

export function DialogBackdrop(props: DialogBackdropProps) {
  const rest = omit(props, 'class');
  return (
    <UiDialogBackdrop
      {...rest}
      class={cn(
        'fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0',
        props.class,
      )}
    />
  );
}

export type DialogContentProps = Omit<ComponentProps<typeof UiDialogContent>, 'class'> & {
  class?: string;
  showCloseButton?: boolean;
};

export function DialogContent(props: DialogContentProps) {
  const rest = omit(props, 'class', 'children', 'showCloseButton');
  return (
    <>
      <DialogBackdrop />
      <UiDialogContent
        {...rest}
        class={cn(
          'fixed inset-0 z-50 m-auto grid h-fit max-h-[86dvh] w-[calc(100%-2rem)] max-w-lg gap-4 overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-lg outline-none transition-[opacity,scale] duration-150 data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0',
          props.class,
        )}
      >
        {props.children}
        {props.showCloseButton !== false && (
          <UiDialogClose
            aria-label="关闭"
            class="absolute top-4 right-4 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-xs text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <XIcon class="h-4 w-4" />
          </UiDialogClose>
        )}
      </UiDialogContent>
    </>
  );
}

export function DialogHeader(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'> & { class?: string },
) {
  const rest = omit(props, 'class');
  return (
    <div
      data-slot="dialog-header"
      {...rest}
      class={cn('flex flex-col gap-1.5 text-center sm:text-left', props.class)}
    />
  );
}

export function DialogFooter(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'> & { class?: string },
) {
  const rest = omit(props, 'class');
  return (
    <div
      data-slot="dialog-footer"
      {...rest}
      class={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', props.class)}
    />
  );
}

export type DialogTitleProps = Omit<ComponentProps<typeof UiDialogTitle>, 'class'> & {
  class?: string;
};

export function DialogTitle(props: DialogTitleProps) {
  const rest = omit(props, 'class');
  return (
    <UiDialogTitle
      {...rest}
      class={cn('text-base leading-none font-semibold text-foreground', props.class)}
    />
  );
}

export type DialogDescriptionProps = Omit<ComponentProps<typeof UiDialogDescription>, 'class'> & {
  class?: string;
};

export function DialogDescription(props: DialogDescriptionProps) {
  const rest = omit(props, 'class');
  return <UiDialogDescription {...rest} class={cn('text-xs text-muted-foreground', props.class)} />;
}
