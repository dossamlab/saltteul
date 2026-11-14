package kr.saltteul.app.widget;

/** 4x4 month calendar: owner-coloured bars drawn as one bitmap, + opens quick add (design 2026-11-14 section 2). */
public class CalendarWidget extends BaseWidgetProvider {
    @Override
    protected String kind() {
        return WidgetLogic.KIND_CALENDAR;
    }
}
