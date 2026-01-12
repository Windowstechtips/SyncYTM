export const BadWords = [
    "damn",
    "hell",
    "shit",
    "fuck",
    "bitch",
    "ass",
    "bastard",
    "crap",
    "dick",
    "piss",
    "cock",
    "cunt",
    "dyke",
    "fag",
    "faggot",
    "nigger",
    "pussy",
    "slut",
    "whore",
    "twat",
    "wanker",
    "asshole",
    "bullshit"
]

export const containsBadWords = (text) => {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return BadWords.some(word => lowerText.includes(word));
}
