#pragma once
#include <vector>
#include <cmath>

// Stereo Delay & Modulation Chorus Unit
class StereoChorus {
    static const int DELAY_BUF_SIZE = 8192;
    float bufL[DELAY_BUF_SIZE] = {0};
    float bufR[DELAY_BUF_SIZE] = {0};
    int writeIdx = 0;
    float lfoPhase = 0.0f;
public:
    void process(const float* inL, const float* inR, float* outL, float* outR, int numFrames, float rateHz, float depthMs, float mix) {
        float sampleRate = 44100.0f;
        float baseDelaySamples = 0.015f * sampleRate; // 15ms base delay
        float modDepthSamples = (depthMs / 1000.0f) * sampleRate;
        float lfoInc = (2.0f * 3.14159265f * rateHz) / sampleRate;

        for (int i = 0; i < numFrames; i++) {
            bufL[writeIdx] = inL[i];
            bufR[writeIdx] = inR[i];

            lfoPhase += lfoInc;
            if (lfoPhase > 2.0f * 3.14159265f) lfoPhase -= 2.0f * 3.14159265f;

            float modL = sinf(lfoPhase) * modDepthSamples;
            float modR = cosf(lfoPhase) * modDepthSamples; // 90 degree stereo offset

            auto readDelayed = [&](float* buf, float delay) {
                float readPos = (float)writeIdx - delay;
                while (readPos < 0.0f) readPos += DELAY_BUF_SIZE;
                int r0 = (int)readPos % DELAY_BUF_SIZE;
                int r1 = (r0 + 1) % DELAY_BUF_SIZE;
                float frac = readPos - (int)readPos;
                return buf[r0] + frac * (buf[r1] - buf[r0]);
            };

            float wetL = readDelayed(bufL, baseDelaySamples + modL);
            float wetR = readDelayed(bufR, baseDelaySamples + modR);

            outL[i] = inL[i] * (1.0f - mix * 0.5f) + wetL * mix;
            outR[i] = inR[i] * (1.0f - mix * 0.5f) + wetR * mix;

            writeIdx = (writeIdx + 1) % DELAY_BUF_SIZE;
        }
    }
};

// Studio Freeverb Stereo Algorithmic Reverb
class StudioReverb {
    struct Comb {
        std::vector<float> buffer;
        int bufSize = 0;
        int bufIdx = 0;
        float filterStore = 0.0f;
        float damp = 0.2f;
        float feedback = 0.8f;
        void init(int size, float d, float fb) {
            bufSize = size;
            buffer.assign(size, 0.0f);
            damp = d;
            feedback = fb;
        }
        float process(float input) {
            float output = buffer[bufIdx];
            filterStore = (output * (1.0f - damp)) + (filterStore * damp);
            buffer[bufIdx] = input + (filterStore * feedback);
            bufIdx = (bufIdx + 1) % bufSize;
            return output;
        }
    };

    struct AllPass {
        std::vector<float> buffer;
        int bufSize = 0;
        int bufIdx = 0;
        float feedback = 0.5f;
        void init(int size, float fb = 0.5f) {
            bufSize = size;
            buffer.assign(size, 0.0f);
            feedback = fb;
        }
        float process(float input) {
            float bufOut = buffer[bufIdx];
            float output = -input + bufOut;
            buffer[bufIdx] = input + (bufOut * feedback);
            bufIdx = (bufIdx + 1) % bufSize;
            return output;
        }
    };

    Comb combsL[8];
    Comb combsR[8];
    AllPass allPassL[4];
    AllPass allPassR[4];

public:
    StudioReverb() {
        int combTuningsL[8] = {1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617};
        int combTuningsR[8] = {1116 + 23, 1188 + 23, 1277 + 23, 1356 + 23, 1422 + 23, 1491 + 23, 1557 + 23, 1617 + 23};
        int allpassTuningsL[4] = {556, 441, 341, 225};
        int allpassTuningsR[4] = {556 + 23, 441 + 23, 341 + 23, 225 + 23};

        for (int i = 0; i < 8; i++) {
            combsL[i].init(combTuningsL[i], 0.25f, 0.84f);
            combsR[i].init(combTuningsR[i], 0.25f, 0.84f);
        }
        for (int i = 0; i < 4; i++) {
            allPassL[i].init(allpassTuningsL[i], 0.5f);
            allPassR[i].init(allpassTuningsR[i], 0.5f);
        }
    }

    void process(const float* inL, const float* inR, float* outL, float* outR, int numFrames, float wet) {
        for (int i = 0; i < numFrames; i++) {
            float input = (inL[i] + inR[i]) * 0.015f;
            float outLeft = 0.0f;
            float outRight = 0.0f;

            for (int c = 0; c < 8; c++) {
                outLeft += combsL[c].process(input);
                outRight += combsR[c].process(input);
            }

            for (int a = 0; a < 4; a++) {
                outLeft = allPassL[a].process(outLeft);
                outRight = allPassR[a].process(outRight);
            }

            outL[i] += outLeft * wet;
            outR[i] += outRight * wet;
        }
    }
};
