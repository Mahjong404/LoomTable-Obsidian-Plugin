<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { mountControlShowcase } from '../../../tests/gallery/control-showcase';

const host = ref<HTMLElement | null>(null);
let dispose: (() => void) | undefined;
onMounted(() => {
  if (host.value !== null) dispose = mountControlShowcase(host.value).dispose;
});
onBeforeUnmount(() => dispose?.());
</script>

<template><div ref="host" /></template>
