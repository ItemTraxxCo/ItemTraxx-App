<template>
  <div class="index-about-page">
    <main class="index-about-container">
      <div class="index-article-topline">
        <RouterLink class="index-back-link" to="/index">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 10H5m5 5-5-5 5-5" /></svg>
          All
        </RouterLink>
        <span class="index-about-label">ABOUT THE INDEX</span>
      </div>

      <article class="index-about-content">
        <h1>We believe transparency helps build trust.</h1>
        <p class="index-about-lead">
          We want people to understand how we approach our work at ItemTraxx, what practices guide us, and how our company and product evolve.
        </p>
        <div class="index-about-divider"></div>
        <section>
          <h2>Why we created the Index</h2>
          <p>
            The Index gives us a place to share more of that openly. We’ll publish articles, practical guides, product updates, and information about our company practices as we have useful things to explain and share.
          </p>
          <p>
            Our goal is to make it easier for customers, partners, and anyone interested in ItemTraxx to see how we think, what we’re learning, and how our work changes over time.
          </p>
        </section>
        <RouterLink class="index-return-link" to="/index">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 10H5m5 5-5-5 5-5" /></svg>
          Explore the Index
        </RouterLink>
      </article>
      <PublicFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import "./index/index.css";
</script>
