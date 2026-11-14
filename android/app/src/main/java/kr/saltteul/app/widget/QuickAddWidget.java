package kr.saltteul.app.widget;

/** 4x1 quick-add bar: the bar opens quick add, the mic opens it recording (design 2026-11-14 section 1.3). */
public class QuickAddWidget extends BaseWidgetProvider {
    @Override
    protected String kind() {
        return WidgetLogic.KIND_QUICK_ADD;
    }
}
