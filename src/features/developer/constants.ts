export const API_KEY_PREFIX = "dot_live_";

/** Characters of randomness after the prefix. 24 random bytes encode to exactly 32 base64url characters. */
export const API_KEY_RANDOM_BYTES = 24;
export const API_KEY_RANDOM_LENGTH = 32;

/** How much of the key is stored in clear for display: the prefix plus a short discriminator. */
export const API_KEY_DISPLAY_CHARS = 6;
